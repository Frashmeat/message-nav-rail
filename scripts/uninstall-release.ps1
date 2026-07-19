param(
  [string]$InstallRoot = "",
  [switch]$RestorePrevious
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Copy-DirectoryContents {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

if (-not $InstallRoot) { $InstallRoot = Join-Path $env:USERPROFILE ".message-nav-rail" }
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$statePath = Join-Path $InstallRoot "installation.json"
if (-not (Test-Path -LiteralPath $statePath)) { throw "Installation state not found: $statePath" }
if (Get-Process omp -ErrorAction SilentlyContinue) { throw "omp.exe is running. Close all Oh My Pi sessions first." }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$targetOmp = [string]$state.targetOmp
$extensionRoot = [string]$state.extensionRoot
$backupDir = [string]$state.backupDir
$pluginRoot = Join-Path $env:USERPROFILE ".omp\plugins"
$pluginPath = Join-Path $pluginRoot "node_modules\message-nav-rail"
$pluginLockPath = Join-Path $pluginRoot "omp-plugins.lock.json"
$keepExtensionRoot = $false

if (-not $RestorePrevious) { throw "Use -RestorePrevious to confirm restoring the pre-installation state." }
if (-not (Test-Path -LiteralPath $backupDir)) { throw "Backup directory not found: $backupDir" }

if (Test-Path -LiteralPath $pluginPath) { Remove-Item -LiteralPath $pluginPath -Recurse -Force }
$snapshotPath = Join-Path $backupDir "plugin-snapshot.json"
if (Test-Path -LiteralPath $snapshotPath) {
  $snapshot = Get-Content -Raw -LiteralPath $snapshotPath | ConvertFrom-Json
  if ($snapshot.exists) {
    $snapshotTargets = @($snapshot.target | Where-Object { $_ })
    New-Item -ItemType Directory -Path (Split-Path -Parent $pluginPath) -Force | Out-Null
    if ($snapshot.backupDirectory -and (Test-Path -LiteralPath ([string]$snapshot.backupDirectory))) {
      if ($snapshotTargets.Count -gt 0) {
        $restoredTarget = [string]$snapshotTargets[0]
        if ([System.IO.Path]::GetFullPath($restoredTarget).Equals([System.IO.Path]::GetFullPath($extensionRoot), [StringComparison]::OrdinalIgnoreCase)) { $keepExtensionRoot = $true }
        if (Test-Path -LiteralPath $restoredTarget) { Remove-Item -LiteralPath $restoredTarget -Recurse -Force }
        Copy-DirectoryContents -Source ([string]$snapshot.backupDirectory) -Destination $restoredTarget
        $linkType = if ([string]$snapshot.linkType -eq "Junction") { "Junction" } else { "SymbolicLink" }
        New-Item -ItemType $linkType -Path $pluginPath -Target $restoredTarget | Out-Null
      } else {
        Copy-DirectoryContents -Source ([string]$snapshot.backupDirectory) -Destination $pluginPath
      }
    } elseif ($snapshotTargets.Count -gt 0) {
      $linkType = if ([string]$snapshot.linkType -eq "Junction") { "Junction" } else { "SymbolicLink" }
      New-Item -ItemType $linkType -Path $pluginPath -Target ([string]$snapshotTargets[0]) | Out-Null
    }
  }
}
$backupLock = Join-Path $backupDir "omp-plugins.lock.json"
if (Test-Path -LiteralPath $backupLock) {
  New-Item -ItemType Directory -Path $pluginRoot -Force | Out-Null
  Copy-Item -LiteralPath $backupLock -Destination $pluginLockPath -Force
} elseif (Test-Path -LiteralPath $pluginLockPath) {
  Remove-Item -LiteralPath $pluginLockPath -Force
}

$backupOmp = Join-Path $backupDir "omp.exe"
if (Test-Path -LiteralPath $backupOmp) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $targetOmp) -Force | Out-Null
  Copy-Item -LiteralPath $backupOmp -Destination $targetOmp -Force
  & $targetOmp --version
  if ($LASTEXITCODE -ne 0) { throw "Restored omp.exe failed health check." }
} elseif (Test-Path -LiteralPath $targetOmp) {
  Remove-Item -LiteralPath $targetOmp -Force
}

if (-not $keepExtensionRoot -and (Test-Path -LiteralPath $extensionRoot)) { Remove-Item -LiteralPath $extensionRoot -Recurse -Force }
$backupState = Join-Path $backupDir "installation.json"
if (Test-Path -LiteralPath $backupState) {
  Copy-Item -LiteralPath $backupState -Destination $statePath -Force
} else {
  Remove-Item -LiteralPath $statePath -Force
}
Write-Host "Restored the state captured before bundle $($state.bundleVersion)."
