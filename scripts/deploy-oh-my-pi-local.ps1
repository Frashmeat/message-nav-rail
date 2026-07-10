param(
  [string]$BuiltOmp = "",
  [string]$Repo = "",
  [string]$SourceNativeDir = "",
  [string]$NativesCacheRoot = "",
  [string]$TargetOmp = "",
  [string]$ExtensionRoot = "",
  [switch]$SkipExtensionInstall
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Repo) {
  $Repo = Join-Path $projectRoot "ohmypi\oh-my-pi-clean"
}
if (-not $BuiltOmp) {
  $BuiltOmp = Join-Path $Repo "packages\coding-agent\dist\omp.exe"
}
if (-not $SourceNativeDir) {
  $SourceNativeDir = Join-Path $Repo "packages\natives\native"
}
if (-not $NativesCacheRoot) {
  $NativesCacheRoot = Join-Path $env:USERPROFILE ".omp\natives"
}
if (-not $TargetOmp) {
  $TargetOmp = Join-Path $env:USERPROFILE ".local\bin\omp.exe"
}
if (-not $ExtensionRoot) {
  $ExtensionRoot = $projectRoot
}

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

function Sync-NativeCache {
  $version = Get-NativeVersion
  $sentinel = Get-NativeSentinel $version
  $source = Get-ChildItem -LiteralPath $SourceNativeDir -Filter "pi_natives.win32-x64*.node" -ErrorAction SilentlyContinue |
    Sort-Object Name |
    Select-Object -First 1

  if (-not $source) {
    throw "Native addon was not found in $SourceNativeDir. Build it first: bun --cwd=packages/natives run build"
  }
  if (-not (Test-FileContainsAscii $source.FullName $sentinel)) {
    throw "Native addon $($source.FullName) does not match @oh-my-pi/pi-natives@$version; missing sentinel $sentinel. Rebuild native first: bun --cwd=packages/natives run build"
  }

  $cacheDir = Join-Path $NativesCacheRoot $version
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
  $dest = Join-Path $cacheDir $source.Name
  Copy-Item -LiteralPath $source.FullName -Destination $dest -Force
  Write-Host "Synced native addon cache: $dest"
}

if (-not (Test-Path -LiteralPath $BuiltOmp)) {
  throw "Built omp.exe not found: $BuiltOmp"
}

Sync-NativeCache

$targetDir = Split-Path -Parent $TargetOmp
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

if (Get-Process omp -ErrorAction SilentlyContinue) {
  throw "omp.exe is currently running. Close Oh My Pi sessions before deploying."
}

if (Test-Path -LiteralPath $TargetOmp) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupPath = "$TargetOmp.$timestamp.bak"
  Copy-Item -LiteralPath $TargetOmp -Destination $backupPath -Force
  Write-Host "Backed up existing omp.exe to $backupPath"
}

Copy-Item -LiteralPath $BuiltOmp -Destination $TargetOmp -Force
Write-Host "Deployed $BuiltOmp to $TargetOmp"

Write-Host "Installed omp version:"
Invoke-Checked $TargetOmp "--version"

if (-not $SkipExtensionInstall) {
  Write-Host "Installing message-nav-rail extension..."
  Invoke-Checked $TargetOmp "install" $ExtensionRoot "--force"
}

Write-Host "Deployment completed."
