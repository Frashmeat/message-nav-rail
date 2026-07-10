param(
  [string]$Repo = "",
  [string]$BunVersion = "1.3.14",
  [string]$TempRoot = "",
  [string]$NativesCacheRoot = "",
  [switch]$BuildNative,
  [switch]$NoAutoCargoPath,
  [switch]$NoAutoVsDevShell,
  [switch]$SkipBunInstall,
  [switch]$SkipDepsInstall,
  [switch]$SkipTests,
  [switch]$SkipCheck
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Repo) {
  $Repo = Join-Path $projectRoot "ohmypi\oh-my-pi-clean"
}

if (-not $TempRoot) {
  $TempRoot = Join-Path (Split-Path -Parent $PSScriptRoot) ".tmp"
}
$verifyTemp = Join-Path $TempRoot "oh-my-pi-verify"
$bunCache = Join-Path $TempRoot "bun-cache"
New-Item -ItemType Directory -Force -Path $verifyTemp, $bunCache | Out-Null
$env:TEMP = $verifyTemp
$env:TMP = $verifyTemp
$env:BUN_INSTALL_CACHE_DIR = $bunCache

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Add-PathForCurrentProcess {
  param([string]$PathToAdd)
  if (-not $PathToAdd -or -not (Test-Path -LiteralPath $PathToAdd)) {
    return
  }
  $fullPathToAdd = (Resolve-Path -LiteralPath $PathToAdd).Path
  $parts = @($env:PATH -split ';' | Where-Object {
    $_ -and $_.Trim() -and ([string]::Compare($_.TrimEnd('\'), $fullPathToAdd.TrimEnd('\'), $true) -ne 0)
  })
  $env:PATH = (@($fullPathToAdd) + $parts) -join ';'
}

function Add-CargoPathForCurrentProcess {
  if ($NoAutoCargoPath) {
    return
  }
  Add-PathForCurrentProcess (Join-Path $env:USERPROFILE ".cargo\bin")
}

function Import-VsDevEnvironment {
  if ($NoAutoVsDevShell) {
    return
  }
  if (Get-Command cl -ErrorAction SilentlyContinue) {
    return
  }

  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path -LiteralPath $vswhere)) {
    return
  }

  $installPath = (& $vswhere "-latest" "-products" "*" "-requires" "Microsoft.VisualStudio.Component.VC.Tools.x86.x64" "-property" "installationPath" 2>$null | Select-Object -First 1)
  if (-not $installPath) {
    return
  }

  $vsDevCmd = Join-Path $installPath "Common7\Tools\VsDevCmd.bat"
  if (-not (Test-Path -LiteralPath $vsDevCmd)) {
    return
  }

  Write-Host "Loading Visual Studio x64 developer environment..."
  $envLines = cmd.exe /s /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
  if ($LASTEXITCODE -ne 0) {
    return
  }

  foreach ($line in $envLines) {
    $equalsIndex = $line.IndexOf("=")
    if ($equalsIndex -le 0) {
      continue
    }
    $name = $line.Substring(0, $equalsIndex)
    $value = $line.Substring($equalsIndex + 1)
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Get-BunCommand {
  $cmd = Get-Command bun -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $npmPrefix = npm config get prefix 2>$null
  if ($npmPrefix) {
    Add-PathForCurrentProcess $npmPrefix
  }
  Add-PathForCurrentProcess (Join-Path $env:USERPROFILE ".bun\bin")
  Add-PathForCurrentProcess (Join-Path $env:USERPROFILE ".local\bin")

  $cmd = Get-Command bun -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }
  return $null
}

function Require-Repo {
  if (-not (Test-Path -LiteralPath $Repo)) {
    throw "Oh My Pi repo not found: $Repo"
  }
  $gitDir = Join-Path $Repo ".git"
  if (-not (Test-Path -LiteralPath $gitDir)) {
    throw "Not a git worktree: $Repo"
  }
}

function Test-DependencyInstalled {
  param([string]$RelativePath)
  return Test-Path -LiteralPath (Join-Path $Repo $RelativePath)
}

function Get-JsonFile {
  param([string]$Path)
  return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
}

function Get-NativeVersion {
  $pkg = Get-JsonFile (Join-Path $Repo "packages\natives\package.json")
  return [string]$pkg.version
}

function Get-NativeSentinel {
  param([string]$Version)
  return "__piNativesV$($Version.Replace(".", "_"))"
}

function Test-FileContainsAscii {
  param(
    [string]$Path,
    [string]$Needle
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $text = [System.Text.Encoding]::ASCII.GetString($bytes)
  return $text.Contains($Needle)
}

function Get-NativePlatformTag {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "This verification helper currently supports native restore/build checks on Windows only."
  }

  $archCandidates = @(
    $env:PROCESSOR_ARCHITECTURE,
    $env:PROCESSOR_ARCHITEW6432
  ) | Where-Object { $_ }

  if ($archCandidates -contains "ARM64") {
    return "win32-arm64"
  }
  if ($archCandidates -contains "AMD64" -or $archCandidates -contains "X64") {
    return "win32-x64"
  }

  if ([Environment]::Is64BitOperatingSystem) {
    return "win32-x64"
  }
  throw "Unsupported processor architecture for Oh My Pi native addon: PROCESSOR_ARCHITECTURE=$env:PROCESSOR_ARCHITECTURE, PROCESSOR_ARCHITEW6432=$env:PROCESSOR_ARCHITEW6432"
}

function Get-RequiredNativeAddonNames {
  param([string]$PlatformTag)

  if ($PlatformTag.EndsWith("-x64")) {
    return @("pi_natives.$PlatformTag-baseline.node", "pi_natives.$PlatformTag.node")
  }
  return @("pi_natives.$PlatformTag.node")
}

function Test-NativeAddonAvailable {
  param(
    [string]$PlatformTag,
    [string[]]$RequiredNames
  )

  $version = Get-NativeVersion
  $sentinel = Get-NativeSentinel $version
  $nativeDir = Join-Path $Repo "packages\natives\native"
  foreach ($name in $RequiredNames) {
    $candidate = Join-Path $nativeDir $name
    if (Test-FileContainsAscii $candidate $sentinel) {
      return $true
    }
  }

  $matching = Get-ChildItem -LiteralPath $nativeDir -Filter "pi_natives.$PlatformTag*.node" -ErrorAction SilentlyContinue
  foreach ($candidate in $matching) {
    if (Test-FileContainsAscii $candidate.FullName $sentinel) {
      return $true
    }
  }
  return $false
}

function Get-NativeAddonDiagnostics {
  param([string]$PlatformTag)

  $version = Get-NativeVersion
  $sentinel = Get-NativeSentinel $version
  $nativeDir = Join-Path $Repo "packages\natives\native"
  $matching = @(Get-ChildItem -LiteralPath $nativeDir -Filter "pi_natives.$PlatformTag*.node" -ErrorAction SilentlyContinue)
  if ($matching.Count -eq 0) {
    return @("No pi_natives.$PlatformTag*.node file exists in $nativeDir.")
  }

  return @($matching | ForEach-Object {
    $hasSentinel = Test-FileContainsAscii $_.FullName $sentinel
    if ($hasSentinel) {
      "$($_.FullName) matches $sentinel"
    } else {
      "$($_.FullName) is present but does not contain $sentinel"
    }
  })
}

function Copy-NativeAddonsFromCache {
  param(
    [string]$Version,
    [string]$PlatformTag
  )

  if (-not $NativesCacheRoot) {
    $NativesCacheRoot = Join-Path $env:USERPROFILE ".omp\natives"
  }

  $cacheDir = Join-Path $NativesCacheRoot $Version
  if (-not (Test-Path -LiteralPath $cacheDir)) {
    return $false
  }

  $sourceFiles = Get-ChildItem -LiteralPath $cacheDir -Filter "pi_natives.$PlatformTag*.node" -ErrorAction SilentlyContinue
  if ($sourceFiles.Count -eq 0) {
    return $false
  }

  $nativeDir = Join-Path $Repo "packages\natives\native"
  New-Item -ItemType Directory -Force -Path $nativeDir | Out-Null
  foreach ($sourceFile in $sourceFiles) {
    $sentinel = Get-NativeSentinel $Version
    if (-not (Test-FileContainsAscii $sourceFile.FullName $sentinel)) {
      Write-Host "Skipping cached native addon with mismatched version sentinel: $($sourceFile.FullName)"
      continue
    }
    Copy-Item -LiteralPath $sourceFile.FullName -Destination (Join-Path $nativeDir $sourceFile.Name) -Force
  }
  Write-Host "Restored native addon from $cacheDir"
  return $true
}

function Invoke-NativeCapture {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  $oldErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    return @{
      ExitCode = $exitCode
      Output = @($output | ForEach-Object { $_.ToString() })
    }
  } finally {
    $ErrorActionPreference = $oldErrorActionPreference
  }
}

function Assert-NativeBuildPrerequisites {
  Add-CargoPathForCurrentProcess
  Import-VsDevEnvironment

  $rustProbe = Invoke-NativeCapture "rustc" "-vV"
  $rustVersion = @($rustProbe.Output | Where-Object { $_ -match "^(rustc|binary:|commit-|host:|release|LLVM version:)" })
  if ($rustProbe.ExitCode -ne 0 -or -not $rustVersion) {
    $details = ($rustProbe.Output -join "`n")
    throw "rustc -vV failed while checking the Oh My Pi native build toolchain. Install/sync nightly-2026-04-29-x86_64-pc-windows-msvc and ensure rustup can write to its cache, then rerun this script.`n$details"
  }
  $rustHost = ($rustVersion | Where-Object { $_ -like "host:*" } | Select-Object -First 1)
  if ($rustHost -notlike "*x86_64-pc-windows-msvc*") {
    $rustSource = (Get-Command rustc -ErrorAction SilentlyContinue).Source
    throw "Oh My Pi native addon must be built with the Windows MSVC Rust toolchain. Current $rustHost from $rustSource. Install rustup and switch to nightly-2026-04-29-x86_64-pc-windows-msvc, then rerun this script from Developer PowerShell."
  }
  if (-not (Get-Command cl -ErrorAction SilentlyContinue)) {
    throw "MSVC compiler cl.exe was not found on PATH. Open x64 Native Tools PowerShell/Command Prompt for Visual Studio, or install Visual Studio Build Tools with Desktop development with C++."
  }
}

function Invoke-NativeBuild {
  Assert-NativeBuildPrerequisites
  $oldTargetVariant = $env:TARGET_VARIANT
  try {
    if ((Get-NativePlatformTag).EndsWith("-x64")) {
      $env:TARGET_VARIANT = "baseline"
      Write-Host "Building native addon with TARGET_VARIANT=baseline..."
    } else {
      Write-Host "Building native addon..."
    }
    Invoke-Checked $bun "--cwd=packages/natives" "run" "build"
  } finally {
    $env:TARGET_VARIANT = $oldTargetVariant
  }
}

function Test-OrRestoreNativeAddon {
  $platformTag = Get-NativePlatformTag
  $requiredNames = Get-RequiredNativeAddonNames $platformTag
  if (Test-NativeAddonAvailable $platformTag $requiredNames) {
    return $true
  }

  $nativesPackage = Get-JsonFile (Join-Path $Repo "packages\natives\package.json")
  Write-Host "Native addon missing for $platformTag; checking installed Oh My Pi native cache..."
  if (Copy-NativeAddonsFromCache $nativesPackage.version $platformTag) {
    return Test-NativeAddonAvailable $platformTag $requiredNames
  }
  return $false
}

function Ensure-NativeAddonReady {
  $platformTag = Get-NativePlatformTag
  $requiredNames = Get-RequiredNativeAddonNames $platformTag
  if (Test-NativeAddonAvailable $platformTag $requiredNames) {
    return
  }

  $diagnostics = Get-NativeAddonDiagnostics $platformTag
  $diagnostics | ForEach-Object { Write-Host $_ }

  if (Test-OrRestoreNativeAddon) {
    return
  }

  if ($BuildNative) {
    Invoke-NativeBuild
    if (Test-NativeAddonAvailable $platformTag $requiredNames) {
      return
    }
    $details = (Get-NativeAddonDiagnostics $platformTag) -join "`n"
    throw "Native build finished but required addon was not found or does not match @oh-my-pi/pi-natives@$(Get-NativeVersion).`n$details"
  }

  $nativesPackage = Get-JsonFile (Join-Path $Repo "packages\natives\package.json")
  $expected = $requiredNames -join " or "
  $details = $diagnostics -join "`n"
  throw "Oh My Pi workspace native addon is missing or version-mismatched ($expected). Required sentinel: $(Get-NativeSentinel $nativesPackage.version). Rerun with -BuildNative.`n$details"
}

function Invoke-BunInstallWithRetry {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    & $bun "install"
    $exitCode = $LASTEXITCODE
    $hasZodV4 = Test-DependencyInstalled "node_modules\zod\v4"
    $hasMammoth = Test-DependencyInstalled "node_modules\mammoth"

    if ($exitCode -eq 0 -and $hasZodV4 -and $hasMammoth) {
      return
    }

    if ($attempt -lt 3) {
      Write-Host "bun install did not finish cleanly or required packages are missing; retrying ($attempt/3)..."
      Start-Sleep -Seconds 2
    }
  }

  throw "bun install did not produce required dependencies. Missing zod/v4 or mammoth; close processes that may lock node_modules/cache, then rerun this script."
}

Require-Repo
Add-CargoPathForCurrentProcess

$bun = Get-BunCommand
$currentVersion = $null
if ($bun) {
  $currentVersion = (& $bun --version).Trim()
}

if ($currentVersion -ne $BunVersion) {
  if ($SkipBunInstall) {
    $displayVersion = $currentVersion
    if (-not $displayVersion) {
      $displayVersion = "not installed"
    }
    throw "bun $BunVersion is required, current: $displayVersion"
  }

  Write-Host "Installing bun@$BunVersion with npm..."
  Invoke-Checked "npm" "install" "-g" "bun@$BunVersion"
  $bun = Get-BunCommand
  if (-not $bun) {
    throw "bun install finished but bun is not on PATH. Restart PowerShell or add npm global prefix to PATH."
  }
  $currentVersion = (& $bun --version).Trim()
}

if ($currentVersion -ne $BunVersion) {
  throw "Expected bun $BunVersion, got $currentVersion at $bun"
}

Write-Host "Using bun $currentVersion at $bun"

Push-Location $Repo
try {
  $safeRepo = (Resolve-Path -LiteralPath $Repo).Path.Replace("\", "/")
  Write-Host "Oh My Pi branch:"
  Invoke-Checked "git" "-c" "safe.directory=$safeRepo" "branch" "--show-current"
  Write-Host "Oh My Pi version:"
  Invoke-Checked $bun "--cwd=packages/coding-agent" "-e" "console.log(require('./package.json').version)"

  if ($BuildNative -and -not (Test-OrRestoreNativeAddon)) {
    Assert-NativeBuildPrerequisites
  }

  if (-not $SkipDepsInstall) {
    Write-Host "Installing dependencies with bun install..."
    Invoke-BunInstallWithRetry
  }

  Ensure-NativeAddonReady

  if (-not $SkipTests) {
    Write-Host "Running focused tests..."
    Invoke-Checked $bun "test" "packages/coding-agent/test/modes/components/transcript-container.test.ts"
    Invoke-Checked $bun "test" "packages/coding-agent/test/input-controller-keybindings.test.ts"
    Invoke-Checked $bun "test" "packages/coding-agent/src/modes/controllers/extension-ui-controller.test.ts"
  }

  if (-not $SkipCheck) {
    Write-Host "Running package check..."
    Invoke-Checked $bun "--cwd=packages/coding-agent" "run" "check"
  }
} finally {
  Pop-Location
}

Write-Host "Verification completed."
