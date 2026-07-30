Set-StrictMode -Version Latest

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not ("ChipMateQaInput" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class ChipMateQaInput
{
    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion data;
    }

    [StructLayout(LayoutKind.Explicit, Size = 32)]
    private struct InputUnion
    {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort key;
        public ushort scan;
        public uint flags;
        public uint time;
        public IntPtr extra;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, INPUT[] input, int size);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr handle);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr handle, int command);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool MoveWindow(IntPtr handle, int x, int y, int width, int height, bool repaint);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr handle, out RECT rect);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr handle, IntPtr process);

    [DllImport("user32.dll")]
    private static extern IntPtr GetKeyboardLayout(uint thread);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    private static INPUT Key(ushort value, uint flags)
    {
        return new INPUT {
            type = 1,
            data = new InputUnion { keyboard = new KEYBDINPUT { key = value, flags = flags } }
        };
    }

    public static void PressChord(ushort modifier, ushort key)
    {
        INPUT[] input = new INPUT[] { Key(modifier, 0), Key(key, 0), Key(key, 2), Key(modifier, 2) };
        if (SendInput((uint)input.Length, input, Marshal.SizeOf(typeof(INPUT))) != input.Length)
            throw new InvalidOperationException("SendInput did not send the complete key chord. Win32=" + Marshal.GetLastWin32Error() + " size=" + Marshal.SizeOf(typeof(INPUT)));
    }

    public static void PressKey(ushort key)
    {
        INPUT[] input = new INPUT[] { Key(key, 0), Key(key, 2) };
        if (SendInput((uint)input.Length, input, Marshal.SizeOf(typeof(INPUT))) != input.Length)
            throw new InvalidOperationException("SendInput did not send the complete key. Win32=" + Marshal.GetLastWin32Error() + " size=" + Marshal.SizeOf(typeof(INPUT)));
    }

    public static int KeyboardLayout(IntPtr handle)
    {
        uint thread = GetWindowThreadProcessId(handle, IntPtr.Zero);
        return GetKeyboardLayout(thread).ToInt32() & 0xffff;
    }

    public static void Maximize(IntPtr handle)
    {
        ShowWindow(handle, 3);
    }

    public static void Resize(IntPtr handle, int width, int height)
    {
        RECT rect;
        if (!GetWindowRect(handle, out rect))
            throw new InvalidOperationException("GetWindowRect could not read the VS Code window.");
        ShowWindow(handle, 9);
        if (!MoveWindow(handle, rect.left, rect.top, width, height, true))
            throw new InvalidOperationException("MoveWindow could not resize the VS Code window. Win32=" + Marshal.GetLastWin32Error());
    }

    public static void TypeText(string text)
    {
        foreach (char value in text)
        {
            INPUT down = new INPUT {
                type = 1,
                data = new InputUnion { keyboard = new KEYBDINPUT { scan = value, flags = 0x0004 } }
            };
            INPUT up = new INPUT {
                type = 1,
                data = new InputUnion { keyboard = new KEYBDINPUT { scan = value, flags = 0x0004 | 0x0002 } }
            };
            INPUT[] input = new INPUT[] { down, up };
            if (SendInput((uint)input.Length, input, Marshal.SizeOf(typeof(INPUT))) != input.Length)
                throw new InvalidOperationException("SendInput did not send the complete Unicode key pair. Win32=" + Marshal.GetLastWin32Error() + " size=" + Marshal.SizeOf(typeof(INPUT)));
            System.Threading.Thread.Sleep(1);
        }
    }
}
"@
}

$script:EnglishUsesChineseLayout = $false

function Get-ChipMateCodeWindow {
  param(
    [string] $CodePath,
    [string] $WorkspaceHint,
    [int[]] $BeforeIds = @(),
    [int] $LaunchId = 0,
    [string] $EvidencePath
  )
  $limit = (Get-Date).AddSeconds(60)
  do {
    $candidates = @(Get-Process -Name "Code" -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 } |
      ForEach-Object {
        $path = ""
        try { $path = $_.Path } catch { $path = "<unavailable: $($_.Exception.Message)>" }
        $score = 0
        $reasons = New-Object System.Collections.Generic.List[string]
        if ($LaunchId -gt 0 -and $_.Id -eq $LaunchId) {
          $score += 60
          $reasons.Add("launch pid matched")
        }
        if ($BeforeIds -notcontains $_.Id) {
          $score += 40
          $reasons.Add("window appeared after launch")
        }
        if ($CodePath -and (Test-Path -LiteralPath $path -PathType Leaf) -and
          [string]::Equals([IO.Path]::GetFullPath($path), [IO.Path]::GetFullPath($CodePath), [StringComparison]::OrdinalIgnoreCase)) {
          $score += 20
          $reasons.Add("Code.exe path matched")
        }
        if ($WorkspaceHint -and $_.MainWindowTitle.IndexOf($WorkspaceHint, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
          $score += 80
          $reasons.Add("workspace title hint matched")
        }
        [pscustomobject]@{
          id = $_.Id
          handle = $_.MainWindowHandle.ToInt64()
          title = $_.MainWindowTitle
          path = $path
          score = $score
          reasons = @($reasons)
          process = $_
        }
      } | Sort-Object -Property @{ Expression = "score"; Descending = $true }, @{ Expression = "id"; Descending = $true })
    if ($EvidencePath) {
      $parent = Split-Path -Parent $EvidencePath
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
      @($candidates | Select-Object id, handle, title, path, score, reasons) |
        ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    }
    $best = $candidates | Select-Object -First 1
    $next = $candidates | Select-Object -Skip 1 -First 1
    if ($null -ne $best -and $best.score -gt 0 -and ($null -eq $next -or $best.score -gt $next.score)) {
      return $best.process
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $limit)
  throw "Unable to identify one unique VS Code window. See window-candidates.json."
}

function Set-ChipMateForeground {
  param([Parameter(Mandatory = $true)] $Process)
  foreach ($attempt in 1..10) {
    if ([ChipMateQaInput]::SetForegroundWindow($Process.MainWindowHandle)) {
      Start-Sleep -Milliseconds 350
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Unable to foreground VS Code window after 10 attempts."
}

function Set-ChipMateWindowMaximized {
  param([Parameter(Mandatory = $true)] $Process)
  [ChipMateQaInput]::Maximize($Process.MainWindowHandle)
  Start-Sleep -Milliseconds 750
  Set-ChipMateForeground -Process $Process
}

function Set-ChipMateWindowSize {
  param(
    [Parameter(Mandatory = $true)] $Process,
    [Parameter(Mandatory = $true)] [int] $Width,
    [Parameter(Mandatory = $true)] [int] $Height
  )
  [ChipMateQaInput]::Resize($Process.MainWindowHandle, $Width, $Height)
  Start-Sleep -Milliseconds 750
  Set-ChipMateForeground -Process $Process
}

function Save-ChipMateScreenshot {
  param([Parameter(Mandatory = $true)] [string] $Path)
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Test-ChipMateScreenshotContent {
  param([Parameter(Mandatory = $true)] [string] $Path)
  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $colors = New-Object System.Collections.Generic.HashSet[int]
    $stepX = [Math]::Max(1, [int]($bitmap.Width / 24))
    $stepY = [Math]::Max(1, [int]($bitmap.Height / 16))
    for ($x = 0; $x -lt $bitmap.Width; $x += $stepX) {
      for ($y = 0; $y -lt $bitmap.Height; $y += $stepY) {
        [void]$colors.Add($bitmap.GetPixel($x, $y).ToArgb())
      }
    }
    return $colors.Count -gt 3
  } finally {
    $bitmap.Dispose()
  }
}

function Save-ChipMateUiaTree {
  param(
    [Parameter(Mandatory = $true)] $Process,
    [Parameter(Mandatory = $true)] [string] $Path,
    [int] $MaxDepth = 12,
    [int] $MaxNodes = 5000
  )
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
  if ($null -eq $root) { throw "Unable to access VS Code UI Automation root." }
  $script:nodes = 0
  $tree = Convert-ChipMateUiaNode -Element $root -Depth 0 -MaxDepth $MaxDepth -MaxNodes $MaxNodes
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $tree | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Convert-ChipMateUiaNode {
  param($Element, [int] $Depth, [int] $MaxDepth, [int] $MaxNodes)
  $script:nodes += 1
  $current = $Element.Current
  $rect = $current.BoundingRectangle
  $node = [ordered]@{
    name = $current.Name
    automationId = $current.AutomationId
    controlType = $current.ControlType.ProgrammaticName
    enabled = $current.IsEnabled
    keyboardFocusable = $current.IsKeyboardFocusable
    offscreen = $current.IsOffscreen
    bounds = @{ x = $rect.X; y = $rect.Y; width = $rect.Width; height = $rect.Height }
    children = @()
  }
  if ($Depth -ge $MaxDepth -or $script:nodes -ge $MaxNodes) { return $node }
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $child = $walker.GetFirstChild($Element)
  while ($null -ne $child -and $script:nodes -lt $MaxNodes) {
    $node.children += Convert-ChipMateUiaNode -Element $child -Depth ($Depth + 1) -MaxDepth $MaxDepth -MaxNodes $MaxNodes
    $child = $walker.GetNextSibling($child)
  }
  return $node
}

function Invoke-ChipMateCommandPalette {
  param(
    [Parameter(Mandatory = $true)] $Process,
    [Parameter(Mandatory = $true)] [string] $Command
  )
  Set-ChipMateForeground -Process $Process
  [System.Windows.Forms.SendKeys]::SendWait("^+p")
  Start-Sleep -Milliseconds 500
  [ChipMateQaInput]::TypeText($Command)
  Start-Sleep -Milliseconds 600
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Seconds 2
}

function Invoke-ChipMateNamedControl {
  param(
    [Parameter(Mandatory = $true)] $Process,
    [Parameter(Mandatory = $true)] [string[]] $Names
  )
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
  $types = @(
    [System.Windows.Automation.ControlType]::Button,
    [System.Windows.Automation.ControlType]::TabItem,
    [System.Windows.Automation.ControlType]::ListItem,
    [System.Windows.Automation.ControlType]::Hyperlink
  )
  foreach ($type in $types) {
    $controls = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        $type
      ))
    )
    foreach ($control in $controls) {
      foreach ($name in $Names) {
        if ($control.Current.Name -ne $name -and -not $control.Current.Name.StartsWith("$name ")) { continue }
        $script:invoke = $null
        if ($control.TryGetCurrentPattern(
          [System.Windows.Automation.InvokePattern]::Pattern,
          [ref] $script:invoke
        )) {
          $script:invoke.Invoke()
          Start-Sleep -Milliseconds 700
          return $true
        }
        $control.SetFocus()
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Start-Sleep -Milliseconds 700
        return $true
      }
    }
  }
  return $false
}

function Find-ChipMateEdit {
  param(
    [Parameter(Mandatory = $true)] $Process,
    [Parameter(Mandatory = $true)] [string[]] $Names
  )
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
  $edits = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    ))
  )
  foreach ($edit in $edits) {
    $value = "$($edit.Current.Name) $($edit.Current.HelpText) $($edit.Current.AutomationId)"
    foreach ($name in $Names) {
      if ($value -match [Regex]::Escape($name)) { return $edit }
    }
  }
  return $null
}

function Set-ChipMateTextByKeyboard {
  param(
    [Parameter(Mandatory = $true)] $Element,
    [Parameter(Mandatory = $true)] [string] $Text
  )
  $Element.SetFocus()
  Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait("^a")
  [ChipMateQaInput]::TypeText($Text)
  Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait("{TAB}")
}

function Send-ChipMateTextByKeyboard {
  param(
    [Parameter(Mandatory = $true)] $Element,
    [Parameter(Mandatory = $true)] [string] $Text
  )
  $Element.SetFocus()
  Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait("^a")
  [ChipMateQaInput]::TypeText($Text)
  Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

function Send-ChipMateTerminalLine {
  param(
    [Parameter(Mandatory = $true)] $Element,
    [Parameter(Mandatory = $true)] [string] $Text,
    [int] $DelayMilliseconds = 250
  )
  $Element.SetFocus()
  [ChipMateQaInput]::TypeText($Text)
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Milliseconds $DelayMilliseconds
}

function Set-ChipMateChineseIme {
  param([Parameter(Mandatory = $true)] $Process)
  Set-ChipMateForeground -Process $Process
  foreach ($attempt in 1..8) {
    if ([ChipMateQaInput]::KeyboardLayout($Process.MainWindowHandle) -eq 0x0804) {
      if ($script:EnglishUsesChineseLayout) {
        [ChipMateQaInput]::PressKey(0x10)
        Start-Sleep -Milliseconds 500
        $script:EnglishUsesChineseLayout = $false
      }
      return $true
    }
    [ChipMateQaInput]::PressChord(0x5B, 0x20)
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Set-ChipMateEnglishKeyboard {
  param([Parameter(Mandatory = $true)] $Process)
  Set-ChipMateForeground -Process $Process
  $script:EnglishUsesChineseLayout = $false
  foreach ($attempt in 1..8) {
    $layout = [ChipMateQaInput]::KeyboardLayout($Process.MainWindowHandle)
    if (($layout -band 0x03ff) -eq 0x0009) { return $true }
    [ChipMateQaInput]::PressChord(0x5B, 0x20)
    Start-Sleep -Milliseconds 500
  }
  if ([ChipMateQaInput]::KeyboardLayout($Process.MainWindowHandle) -eq 0x0804) {
    # Microsoft Pinyin can be the only installed keyboard. Its English input
    # mode keeps the zh-CN HKL, so switch modes with the documented Shift key.
    [ChipMateQaInput]::PressKey(0x10)
    Start-Sleep -Milliseconds 500
    $script:EnglishUsesChineseLayout = $true
    return $true
  }
  return $false
}

function Send-ChipMateImeComposition {
  param(
    [Parameter(Mandatory = $true)] $Process,
    [Parameter(Mandatory = $true)] $Element,
    [Parameter(Mandatory = $true)] [string] $Pinyin
  )
  if (-not (Set-ChipMateChineseIme -Process $Process)) { return $false }
  $Element.SetFocus()
  Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait($Pinyin)
  Start-Sleep -Milliseconds 800
  return $true
}

function Find-ChipMateFocusableEdit {
  param([Parameter(Mandatory = $true)] $Process)
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
  $edits = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    ))
  )
  for ($index = $edits.Count - 1; $index -ge 0; $index -= 1) {
    $edit = $edits.Item($index)
    if ($edit.Current.IsEnabled -and $edit.Current.IsKeyboardFocusable -and -not $edit.Current.IsOffscreen) { return $edit }
  }
  return $null
}

function Find-ChipMateTerminalEdit {
  param([Parameter(Mandatory = $true)] $Process)
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
  $bounds = $root.Current.BoundingRectangle
  $minimum = $bounds.Left + ($bounds.Width * 0.25)
  $edits = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    ))
  )
  $candidates = @()
  foreach ($edit in $edits) {
    $current = $edit.Current
    $rect = $current.BoundingRectangle
    if (-not $current.IsEnabled -or -not $current.IsKeyboardFocusable -or $current.IsOffscreen) { continue }
    if ($rect.Left -lt $minimum -or $rect.Width -le 1 -or $rect.Height -le 1) { continue }
    $label = "$($current.Name) $($current.HelpText) $($current.AutomationId)"
    $score = if ($label -match "terminal|xterm|shell|agent console") { 100 } else { 0 }
    $score += [int]($rect.Left - $minimum)
    $score += [int]$rect.Top
    $candidates += [pscustomobject]@{ edit = $edit; score = $score; label = $label; left = $rect.Left; top = $rect.Top }
  }
  $match = $candidates | Sort-Object -Property @{ Expression = "score"; Descending = $true } | Select-Object -First 1
  if ($null -eq $match) { return $null }
  return $match.edit
}

function Get-ChipMateElementValue {
  param([Parameter(Mandatory = $true)] $Element)
  $script:valuePattern = $null
  if (-not $Element.TryGetCurrentPattern(
    [System.Windows.Automation.ValuePattern]::Pattern,
    [ref] $script:valuePattern
  )) { return $null }
  return $script:valuePattern.Current.Value
}
