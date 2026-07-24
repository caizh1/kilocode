# ChipMate Agent Console integration for PowerShell 7 and Windows PowerShell 5.1.
# User profiles load before this script. The wrappers below preserve the user's
# prompt and PSReadLine editing while emitting private lifecycle markers.

$global:__chipmate_token = $env:KILO_AGENT_CONSOLE_TOKEN
Remove-Item Env:KILO_AGENT_CONSOLE -ErrorAction SilentlyContinue
Remove-Item Env:KILO_AGENT_CONSOLE_TOKEN -ErrorAction SilentlyContinue

if ($global:__chipmate_token -notmatch '^[a-fA-F0-9]{32}$') {
  return
}

$global:__chipmate_first = $true
$global:__chipmate_agent_mode = $true
$global:__chipmate_request = ""
$global:__chipmate_current = ""
$global:__chipmate_pending = ""
$global:__chipmate_prompt = (Get-Command prompt -CommandType Function -ErrorAction SilentlyContinue).ScriptBlock
if (-not $global:__chipmate_prompt) {
  $global:__chipmate_prompt = { "PS $($executionContext.SessionState.Path.CurrentLocation)> " }
}

function global:__chipmate_emit([string] $Value) {
  [Console]::Write(([char] 27) + "]6973;$global:__chipmate_token;$Value" + ([char] 7))
}

function global:__chipmate_cwd {
  $Value = [string] (Get-Location)
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
}

function global:__chipmate_capture([string] $RequestId) {
  if ($RequestId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
    return
  }
  $Line = ""
  $Cursor = 0
  [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref] $Line, [ref] $Cursor)
  $Match = [regex]::Match($Line.TrimStart(), '^(?:&\s*)?(?:''([^'']+)''|"([^"]+)"|([^\s;&|<>]+))')
  $First = if ($Match.Success) {
    @($Match.Groups[1].Value, $Match.Groups[2].Value, $Match.Groups[3].Value) | Where-Object { $_ } | Select-Object -First 1
  } else {
    ""
  }
  $Name = if ($First) { [WildcardPattern]::Escape($First) } else { "" }
  $Known = if ($Name -and (Get-Command -Name $Name -ErrorAction SilentlyContinue)) { 1 } else { 0 }
  $Encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Line))
  $global:__chipmate_current = $RequestId
  __chipmate_emit "input;$RequestId;$Known;$Encoded"
}

function global:__chipmate_request_reset {
  $global:__chipmate_request = ""
}

function global:__chipmate_request_digit([string] $Value) {
  if ($global:__chipmate_request.Length -lt 32) {
    $global:__chipmate_request += $Value
  }
}

function global:__chipmate_request_apply {
  $Raw = $global:__chipmate_request
  $global:__chipmate_request = ""
  if ($Raw -notmatch '^[0-9a-fA-F]{32}$') {
    return
  }
  $RequestId = "{0}-{1}-{2}-{3}-{4}" -f $Raw.Substring(0, 8), $Raw.Substring(8, 4), $Raw.Substring(12, 4), $Raw.Substring(16, 4), $Raw.Substring(20, 12)
  __chipmate_capture $RequestId
}

function global:__chipmate_enter {
  if ($global:__chipmate_agent_mode) {
    return
  }
  [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
}

function global:__chipmate_execute {
  [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
}

function global:__chipmate_agent_on {
  $global:__chipmate_agent_mode = $true
  __chipmate_emit "ready;$(__chipmate_cwd)"
  $RequestId = $global:__chipmate_pending
  if ($RequestId -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
    $global:__chipmate_pending = ""
    __chipmate_emit "applied;$RequestId;agent"
  }
}

function global:__chipmate_agent_off {
  $global:__chipmate_agent_mode = $false
  __chipmate_emit "ready;$(__chipmate_cwd)"
}

function global:__chipmate_clear {
  $Line = ""
  $Cursor = 0
  [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref] $Line, [ref] $Cursor)
  [Microsoft.PowerShell.PSConsoleReadLine]::Replace(0, $Line.Length, "")
}

function global:__chipmate_applied([string] $Route) {
  $RequestId = $global:__chipmate_current
  if ($RequestId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
    return
  }
  $global:__chipmate_current = ""
  __chipmate_emit "applied;$RequestId;$Route"
}

function global:__chipmate_agent_apply {
  __chipmate_clear
  $global:__chipmate_pending = $global:__chipmate_current
  $global:__chipmate_current = ""
}

function global:__chipmate_shell_apply {
  __chipmate_applied "shell"
}

function global:__chipmate_begin {
  __chipmate_emit "begin;$(__chipmate_cwd)"
  $global:LASTEXITCODE = 0
}

function global:__chipmate_after([bool] $Succeeded, [object] $NativeCode) {
  if ($global:__chipmate_first) {
    __chipmate_emit "prompt;$(__chipmate_cwd)"
    $global:__chipmate_first = $false
    return
  }
  $Code = if ($Succeeded) {
    0
  } elseif ($NativeCode -is [int] -and $NativeCode -gt 0 -and $NativeCode -le 255) {
    $NativeCode
  } else {
    1
  }
  __chipmate_emit "end;$Code;$(__chipmate_cwd)"
}

function global:__chipmate_install {
  Import-Module PSReadLine -ErrorAction Stop

  Set-PSReadLineKeyHandler -Key Enter -ScriptBlock { __chipmate_enter }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+e' -ScriptBlock { __chipmate_execute }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+a' -ScriptBlock { __chipmate_agent_on }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+h' -ScriptBlock { __chipmate_agent_off }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+u' -ScriptBlock { __chipmate_clear }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+y' -ScriptBlock { __chipmate_agent_apply }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+n' -ScriptBlock { __chipmate_shell_apply }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+r' -ScriptBlock { __chipmate_request_reset }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,0' -ScriptBlock { __chipmate_request_digit "0" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,1' -ScriptBlock { __chipmate_request_digit "1" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,2' -ScriptBlock { __chipmate_request_digit "2" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,3' -ScriptBlock { __chipmate_request_digit "3" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,4' -ScriptBlock { __chipmate_request_digit "4" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,5' -ScriptBlock { __chipmate_request_digit "5" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,6' -ScriptBlock { __chipmate_request_digit "6" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,7' -ScriptBlock { __chipmate_request_digit "7" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,8' -ScriptBlock { __chipmate_request_digit "8" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,9' -ScriptBlock { __chipmate_request_digit "9" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,a' -ScriptBlock { __chipmate_request_digit "a" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,b' -ScriptBlock { __chipmate_request_digit "b" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,c' -ScriptBlock { __chipmate_request_digit "c" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,d' -ScriptBlock { __chipmate_request_digit "d" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,e' -ScriptBlock { __chipmate_request_digit "e" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,f' -ScriptBlock { __chipmate_request_digit "f" }
  Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+p' -ScriptBlock { __chipmate_request_apply }

  function global:PSConsoleHostReadLine {
    $Line = PSReadLine\PSConsoleHostReadLine
    __chipmate_begin
    return $Line
  }

  function global:prompt {
    $Succeeded = $?
    $NativeCode = $global:LASTEXITCODE
    __chipmate_after $Succeeded $NativeCode
    & $global:__chipmate_prompt
  }
}

function global:__chipmate_resync {
  __chipmate_install
  __chipmate_emit "resync;$(__chipmate_cwd)"
}

__chipmate_install
