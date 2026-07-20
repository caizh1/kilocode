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

    [StructLayout(LayoutKind.Explicit)]
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
                throw new InvalidOperationException("SendInput did not send the complete Unicode key pair.");
        }
    }
}
"@
}

function Get-ChipMateCodeWindow {
  $limit = (Get-Date).AddSeconds(60)
  do {
    $process = Get-Process -Name "Code" -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 } |
      Sort-Object StartTime -Descending |
      Select-Object -First 1
    if ($null -ne $process) { return $process }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $limit)
  throw "VS Code did not expose a main window within 60 seconds."
}

function Set-ChipMateForeground {
  param([Parameter(Mandatory = $true)] $Process)
  if (-not [ChipMateQaInput]::SetForegroundWindow($Process.MainWindowHandle)) {
    throw "Unable to foreground VS Code window."
  }
  Start-Sleep -Milliseconds 350
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
        if ($control.Current.Name -ne $name) { continue }
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

function Get-ChipMateElementValue {
  param([Parameter(Mandatory = $true)] $Element)
  $script:valuePattern = $null
  if (-not $Element.TryGetCurrentPattern(
    [System.Windows.Automation.ValuePattern]::Pattern,
    [ref] $script:valuePattern
  )) { return $null }
  return $script:valuePattern.Current.Value
}
