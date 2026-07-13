param(
  [string]$Binary = "",
  [ValidateSet("baseline", "modern")]
  [string]$NativeVariant = "baseline",
  [string]$WorkRoot = "",
  [switch]$KeepWorkDir
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Binary) {
  $Binary = Join-Path $projectRoot "ohmypi\oh-my-pi-clean\packages\coding-agent\dist\omp.exe"
}
$Binary = (Resolve-Path -LiteralPath $Binary).Path

if (-not [Environment]::Is64BitOperatingSystem) {
  throw "Probe requires 64-bit Windows."
}
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
  throw "Probe only supports Windows x64 on Intel/AMD x86-64."
}
if (-not [Environment]::Is64BitProcess) {
  throw "Run the probe from 64-bit PowerShell."
}

if (-not $WorkRoot) {
  $WorkRoot = Join-Path $projectRoot ".tmp\omp-binary-probe"
}
$resolvedWorkRoot = [System.IO.Path]::GetFullPath($WorkRoot)
$resolvedProjectRoot = [System.IO.Path]::GetFullPath($projectRoot)
if (-not $resolvedWorkRoot.StartsWith($resolvedProjectRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "WorkRoot must remain inside the project directory: $resolvedProjectRoot"
}

$runId = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$runDir = Join-Path $resolvedWorkRoot $runId
$homeDir = Join-Path $runDir "home"
$binDir = Join-Path $runDir "bin"
$fixtureDir = Join-Path $runDir "fixture"
$probeBinary = Join-Path $binDir "omp.exe"
$resultPath = Join-Path $runDir "probe-result.json"

New-Item -ItemType Directory -Path $homeDir, $binDir, $fixtureDir -Force | Out-Null
Copy-Item -LiteralPath $Binary -Destination $probeBinary -Force
Set-Content -LiteralPath (Join-Path $fixtureDir "probe.txt") -Value "message-nav-rail-native-probe" -Encoding UTF8

$originalEnv = @{
  HOME = $env:HOME
  USERPROFILE = $env:USERPROFILE
  HOMEDRIVE = $env:HOMEDRIVE
  HOMEPATH = $env:HOMEPATH
  PI_NATIVE_VARIANT = $env:PI_NATIVE_VARIANT
  __PI_NATIVE_VARIANT_CACHE = $env:__PI_NATIVE_VARIANT_CACHE
}

function Invoke-ProbeCommand {
  param(
    [string[]]$Arguments,
    [string]$Name
  )
  $stdoutPath = Join-Path $runDir "$Name.stdout.txt"
  $stderrPath = Join-Path $runDir "$Name.stderr.txt"
  $process = Start-Process -FilePath $probeBinary -ArgumentList $Arguments -WorkingDirectory $fixtureDir -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  return [ordered]@{
    arguments = $Arguments
    exitCode = $process.ExitCode
    stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
    stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
  }
}

try {
  $env:HOME = $homeDir
  $env:USERPROFILE = $homeDir
  $env:HOMEDRIVE = [System.IO.Path]::GetPathRoot($homeDir).TrimEnd("\")
  $env:HOMEPATH = $homeDir.Substring([System.IO.Path]::GetPathRoot($homeDir).Length - 1)
  $env:PI_NATIVE_VARIANT = $NativeVariant
  Remove-Item Env:__PI_NATIVE_VARIANT_CACHE -ErrorAction SilentlyContinue

  $beforeFiles = @(Get-ChildItem -LiteralPath $runDir -Recurse -File | ForEach-Object FullName)
  $version = Invoke-ProbeCommand -Arguments @("--version") -Name "version"
  $grep = Invoke-ProbeCommand -Arguments @("grep", "message-nav-rail-native-probe", $fixtureDir, "--limit", "5") -Name "grep"
  $afterFiles = @(Get-ChildItem -LiteralPath $runDir -Recurse -File | ForEach-Object FullName)
  $nativeFiles = @(Get-ChildItem -LiteralPath $homeDir -Recurse -File -Filter "*.node" -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTimeUtc)

  $result = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    sourceBinary = $Binary
    sourceBinarySha256 = (Get-FileHash -LiteralPath $Binary -Algorithm SHA256).Hash.ToLowerInvariant()
    probeBinary = $probeBinary
    platform = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
    osArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    processArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    nativeVariant = $NativeVariant
    isolatedHome = $homeDir
    version = $version
    grep = $grep
    nativeFiles = $nativeFiles
    createdFiles = @($afterFiles | Where-Object { $_ -notin $beforeFiles })
    success = ($version.exitCode -eq 0 -and $grep.exitCode -eq 0 -and $grep.stdout -match "message-nav-rail-native-probe" -and $nativeFiles.Count -gt 0)
  }
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding UTF8
  $result | ConvertTo-Json -Depth 8

  if (-not $result.success) {
    throw "Binary probe failed. Evidence retained at: $runDir"
  }
}
finally {
  foreach ($entry in $originalEnv.GetEnumerator()) {
    if ($null -eq $entry.Value) {
      Remove-Item "Env:$($entry.Key)" -ErrorAction SilentlyContinue
    } else {
      Set-Item "Env:$($entry.Key)" $entry.Value
    }
  }
}

if (-not $KeepWorkDir) {
  Write-Host "Probe succeeded. Evidence retained at: $runDir"
}
