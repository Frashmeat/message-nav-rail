param(
  [string]$InstallRoot = "",
  [string]$TargetOmp = "",
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$bundleRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$manifestPath = Join-Path $bundleRoot "manifest.json"
$checksumsPath = Join-Path $bundleRoot "SHA256SUMS.txt"
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "manifest.json not found." }
if (-not (Test-Path -LiteralPath $checksumsPath)) { throw "SHA256SUMS.txt not found." }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

if ([int]$manifest.schemaVersion -ne 1) { throw "Unsupported manifest schemaVersion: $($manifest.schemaVersion)" }
if ([string]::IsNullOrWhiteSpace([string]$manifest.bundleVersion)) { throw "Release manifest is missing bundleVersion." }
if ([string]::IsNullOrWhiteSpace([string]$manifest.upstreamVersion)) { throw "Release manifest is missing upstreamVersion." }
if (-not [Environment]::Is64BitOperatingSystem) { throw "Only 64-bit Windows is supported." }
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) { throw "Only Windows x64 on Intel/AMD x86-64 is supported." }
if (-not [Environment]::Is64BitProcess) { throw "Run this installer from 64-bit PowerShell." }
if ($manifest.platform -ne "windows" -or $manifest.architecture -ne "x64") { throw "Release manifest is not Windows x64." }

if (-not $InstallRoot) { $InstallRoot = Join-Path $env:USERPROFILE ".message-nav-rail" }
if (-not $TargetOmp) { $TargetOmp = Join-Path $env:USERPROFILE ".local\bin\omp.exe" }
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$TargetOmp = [System.IO.Path]::GetFullPath($TargetOmp)
$statePath = Join-Path $InstallRoot "installation.json"
$extensionRoot = Join-Path $InstallRoot "extension"
$backupRoot = Join-Path $InstallRoot "backups"
$ompPluginsRoot = Join-Path $env:USERPROFILE ".omp\plugins"
$pluginPath = Join-Path $ompPluginsRoot "node_modules\message-nav-rail"
$pluginLockPath = Join-Path $ompPluginsRoot "omp-plugins.lock.json"
$pluginName = "message-nav-rail"

function Copy-DirectoryContents {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

function Invoke-Checked {
  param([string]$FilePath, [string[]]$Arguments)
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')" }
}

function Install-ManagedPlugin {
  param([string]$Source)

  $packagePath = Join-Path $Source "package.json"
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "Plugin package.json not found." }
  $package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
  if ([string]$package.name -ne $pluginName) { throw "Unexpected plugin package name: $($package.name)" }
  if ([string]::IsNullOrWhiteSpace([string]$package.version)) { throw "Plugin package.json is missing version." }

  if (Test-Path -LiteralPath $pluginPath) { Remove-Item -LiteralPath $pluginPath -Recurse -Force }
  Copy-DirectoryContents -Source $Source -Destination $pluginPath

  New-Item -ItemType Directory -Path $ompPluginsRoot -Force | Out-Null
  if (Test-Path -LiteralPath $pluginLockPath) {
    $config = Get-Content -Raw -LiteralPath $pluginLockPath | ConvertFrom-Json
    if ($null -eq $config) { throw "Plugin lock file is empty." }
  } else {
    $config = [pscustomobject]@{
      plugins = [pscustomobject]@{}
      settings = [pscustomobject]@{}
    }
  }

  if (-not ($config.PSObject.Properties.Name -contains "plugins")) {
    Add-Member -InputObject $config -MemberType NoteProperty -Name "plugins" -Value ([pscustomobject]@{})
  } elseif ($null -eq $config.plugins) {
    $config.plugins = [pscustomobject]@{}
  }

  $entry = [pscustomobject]@{
    version = [string]$package.version
    enabledFeatures = $null
    enabled = $true
  }
  Add-Member -InputObject $config.plugins -MemberType NoteProperty -Name $pluginName -Value $entry -Force

  $newPluginLock = "$pluginLockPath.new"
  try {
    $configJson = $config | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($newPluginLock, $configJson, [System.Text.UTF8Encoding]::new($false))
    Get-Content -Raw -LiteralPath $newPluginLock | ConvertFrom-Json | Out-Null
    Move-Item -LiteralPath $newPluginLock -Destination $pluginLockPath -Force
  } finally {
    if (Test-Path -LiteralPath $newPluginLock) { Remove-Item -LiteralPath $newPluginLock -Force }
  }
}

function Test-Checksums {
  $rootPrefix = $bundleRoot.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

  foreach ($line in Get-Content -LiteralPath $checksumsPath) {
    if (-not $line.Trim()) { continue }
    if ($line -notmatch '^([a-fA-F0-9]{64})  (.+)$') { throw "Invalid checksum line: $line" }
    $expected = $Matches[1].ToLowerInvariant()
    $declaredRelative = $Matches[2].Replace('\', '/')
    $relative = $declaredRelative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    if ([System.IO.Path]::IsPathRooted($relative)) { throw "Unsafe checksum path: $declaredRelative" }
    $path = [System.IO.Path]::GetFullPath((Join-Path $bundleRoot $relative))
    if (-not $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe checksum path: $declaredRelative" }
    $canonicalRelative = $path.Substring($rootPrefix.Length).Replace('\', '/')
    if (-not $declaredRelative.Equals($canonicalRelative, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe checksum path: $declaredRelative" }
    if (-not $seen.Add($canonicalRelative)) { throw "Duplicate checksum entry: $canonicalRelative" }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Release file missing: $canonicalRelative" }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Checksum mismatch: $canonicalRelative" }
  }

  $bundleFiles = Get-ChildItem -LiteralPath $bundleRoot -Recurse -File | Where-Object {
    -not $_.FullName.Equals($checksumsPath, [StringComparison]::OrdinalIgnoreCase)
  }
  foreach ($file in $bundleFiles) {
    $relative = $file.FullName.Substring($rootPrefix.Length).Replace('\', '/')
    if (-not $seen.Contains($relative)) { throw "Missing checksum entry: $relative" }
  }
}

function Copy-PluginSnapshot {
  param([string]$Destination)
  if (Test-Path -LiteralPath $pluginLockPath) { Copy-Item -LiteralPath $pluginLockPath -Destination (Join-Path $Destination "omp-plugins.lock.json") -Force }
  if (Test-Path -LiteralPath $pluginPath) {
    $item = Get-Item -LiteralPath $pluginPath -Force
    $linkTargets = @($item.Target)
    $snapshot = [ordered]@{ exists = $true; linkType = [string]$item.LinkType; target = $linkTargets; backupDirectory = $null }
    if (-not $item.LinkType) {
      $pluginBackup = Join-Path $Destination "plugin-directory"
      Copy-DirectoryContents -Source $pluginPath -Destination $pluginBackup
      $snapshot.backupDirectory = $pluginBackup
    } elseif ($linkTargets.Count -gt 0) {
      $targetPath = [System.IO.Path]::GetFullPath([string]$linkTargets[0])
      if ($targetPath.Equals([System.IO.Path]::GetFullPath($extensionRoot), [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $targetPath)) {
        $targetBackup = Join-Path $Destination "managed-extension"
        Copy-DirectoryContents -Source $targetPath -Destination $targetBackup
        $snapshot.backupDirectory = $targetBackup
      }
    }
    $snapshot | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Destination "plugin-snapshot.json") -Encoding UTF8
  } else {
    @{ exists = $false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Destination "plugin-snapshot.json") -Encoding UTF8
  }
}

function Restore-Backup {
  param([string]$BackupDir)
  $backupOmp = Join-Path $BackupDir "omp.exe"
  if (Test-Path -LiteralPath $backupOmp) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $TargetOmp) -Force | Out-Null
    Copy-Item -LiteralPath $backupOmp -Destination $TargetOmp -Force
  } elseif (Test-Path -LiteralPath $TargetOmp) {
    Remove-Item -LiteralPath $TargetOmp -Force
  }
  if (Test-Path -LiteralPath $pluginPath) { Remove-Item -LiteralPath $pluginPath -Recurse -Force }
  $snapshotPath = Join-Path $BackupDir "plugin-snapshot.json"
  if (Test-Path -LiteralPath $snapshotPath) {
    $snapshot = Get-Content -Raw -LiteralPath $snapshotPath | ConvertFrom-Json
    if ($snapshot.exists) {
      $snapshotTargets = @($snapshot.target | Where-Object { $_ })
      New-Item -ItemType Directory -Path (Split-Path -Parent $pluginPath) -Force | Out-Null
      if ($snapshot.backupDirectory -and (Test-Path -LiteralPath ([string]$snapshot.backupDirectory))) {
        if ($snapshotTargets.Count -gt 0) {
          $restoredTarget = [string]$snapshotTargets[0]
          if (Test-Path -LiteralPath $restoredTarget) { Remove-Item -LiteralPath $restoredTarget -Recurse -Force }
          Copy-DirectoryContents -Source ([string]$snapshot.backupDirectory) -Destination $restoredTarget
          $linkType = if ([string]$snapshot.linkType -eq "Junction") { "Junction" } else { "SymbolicLink" }
          New-Item -ItemType $linkType -Path $pluginPath -Target $restoredTarget | Out-Null
        } else {
          Copy-DirectoryContents -Source ([string]$snapshot.backupDirectory) -Destination $pluginPath
        }
      } elseif ($snapshot.target.Count -gt 0) {
        $linkType = if ([string]$snapshot.linkType -eq "Junction") { "Junction" } else { "SymbolicLink" }
        New-Item -ItemType $linkType -Path $pluginPath -Target ([string]$snapshot.target[0]) | Out-Null
      }
    }
  }
  $backupLock = Join-Path $BackupDir "omp-plugins.lock.json"
  if (Test-Path -LiteralPath $backupLock) {
    New-Item -ItemType Directory -Path $ompPluginsRoot -Force | Out-Null
    Copy-Item -LiteralPath $backupLock -Destination $pluginLockPath -Force
  } elseif (Test-Path -LiteralPath $pluginLockPath) {
    Remove-Item -LiteralPath $pluginLockPath -Force
  }
  $backupState = Join-Path $BackupDir "installation.json"
  if (Test-Path -LiteralPath $backupState) {
    Copy-Item -LiteralPath $backupState -Destination $statePath -Force
  } elseif (Test-Path -LiteralPath $statePath) {
    Remove-Item -LiteralPath $statePath -Force
  }
}

Test-Checksums
if ($ValidateOnly) {
  Write-Host "Release manifest and SHA-256 checks passed."
  return
}
if (Get-Process omp -ErrorAction SilentlyContinue) { throw "omp.exe is running. Close all Oh My Pi sessions first." }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$backupDir = Join-Path $backupRoot $timestamp
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
if (Test-Path -LiteralPath $TargetOmp) { Copy-Item -LiteralPath $TargetOmp -Destination (Join-Path $backupDir "omp.exe") -Force }
Copy-PluginSnapshot -Destination $backupDir
if (Test-Path -LiteralPath $statePath) { Copy-Item -LiteralPath $statePath -Destination (Join-Path $backupDir "installation.json") -Force }

try {
  New-Item -ItemType Directory -Path (Split-Path -Parent $TargetOmp), $extensionRoot -Force | Out-Null
  $newOmp = "$TargetOmp.new"
  Copy-Item -LiteralPath (Join-Path $bundleRoot "omp.exe") -Destination $newOmp -Force
  $expectedOmp = (Get-FileHash -LiteralPath (Join-Path $bundleRoot "omp.exe") -Algorithm SHA256).Hash
  $actualOmp = (Get-FileHash -LiteralPath $newOmp -Algorithm SHA256).Hash
  if ($expectedOmp -ne $actualOmp) { throw "Staged omp.exe hash mismatch." }
  if (Test-Path -LiteralPath $TargetOmp) { Move-Item -LiteralPath $TargetOmp -Destination "$TargetOmp.old" -Force }
  Move-Item -LiteralPath $newOmp -Destination $TargetOmp -Force

  if (Test-Path -LiteralPath $extensionRoot) { Remove-Item -LiteralPath $extensionRoot -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $bundleRoot "extension") -Destination $extensionRoot -Recurse -Force
  Install-ManagedPlugin -Source $extensionRoot
  Invoke-Checked -FilePath $TargetOmp -Arguments @("plugin", "list")
  Invoke-Checked -FilePath $TargetOmp -Arguments @("--version")

  $probeFile = Join-Path $InstallRoot "native-probe.txt"
  Set-Content -LiteralPath $probeFile -Value "message-nav-rail-native-probe" -Encoding UTF8
  Invoke-Checked -FilePath $TargetOmp -Arguments @("grep", "message-nav-rail-native-probe", $probeFile, "--limit", "1")
  Remove-Item -LiteralPath $probeFile -Force

  $nativeCache = Join-Path $env:USERPROFILE ".omp\natives\$($manifest.upstreamVersion)"
  if (-not (Get-ChildItem -LiteralPath $nativeCache -Filter "pi_natives.win32-x64*.node" -File -ErrorAction SilentlyContinue)) { throw "Embedded native extraction was not observed at $nativeCache" }

  $state = [ordered]@{
    schemaVersion = 1
    bundleVersion = [string]$manifest.bundleVersion
    upstreamVersion = [string]$manifest.upstreamVersion
    installedAt = (Get-Date).ToUniversalTime().ToString("o")
    targetOmp = $TargetOmp
    extensionRoot = $extensionRoot
    backupDir = $backupDir
    sourceCommit = [string]$manifest.sourceCommit
    ohMyPiCommit = [string]$manifest.ohMyPiCommit
  }
  $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statePath -Encoding UTF8
  if (Test-Path -LiteralPath "$TargetOmp.old") { Remove-Item -LiteralPath "$TargetOmp.old" -Force }
  Write-Host "Installed message-nav-rail bundle $($manifest.bundleVersion)."
  Write-Host "Backup: $backupDir"
} catch {
  Write-Warning "Installation failed; restoring previous state."
  Restore-Backup -BackupDir $backupDir
  if (Test-Path -LiteralPath "$TargetOmp.old") { Remove-Item -LiteralPath "$TargetOmp.old" -Force }
  throw
}
