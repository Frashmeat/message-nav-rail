param(
  [string]$BuiltOmp = "F:\WebCode\message-nav-rail\ohmypi\oh-my-pi-clean\packages\coding-agent\dist\omp.exe",
  [string]$TargetOmp = "C:\Users\Administrator\.local\bin\omp.exe",
  [string]$ExtensionRoot = "F:\WebCode\message-nav-rail",
  [switch]$SkipExtensionInstall
)

$ErrorActionPreference = "Stop"

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

if (-not (Test-Path -LiteralPath $BuiltOmp)) {
  throw "Built omp.exe not found: $BuiltOmp"
}

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
