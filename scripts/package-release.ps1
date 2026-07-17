param(
  [Parameter(Mandatory = $true)]
  [string]$BundleVersion,
  [string]$OmpBinary = "",
  [string]$OutputRoot = "",
  [string]$OhMyPiRepo = "",
  [string]$OhMyPiBaseRef = "",
  [string]$ReleasePatch = "",
  [switch]$SkipExtensionBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OmpBinary) { $OmpBinary = Join-Path $projectRoot "ohmypi\oh-my-pi-clean\packages\coding-agent\dist\omp.exe" }
if (-not $OhMyPiRepo) { $OhMyPiRepo = Join-Path $projectRoot "ohmypi\oh-my-pi-clean" }
if (-not $OutputRoot) { $OutputRoot = Join-Path $projectRoot ".tmp\release" }
$OmpBinary = (Resolve-Path -LiteralPath $OmpBinary).Path
$OhMyPiRepo = (Resolve-Path -LiteralPath $OhMyPiRepo).Path
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)

if ($BundleVersion -notmatch '^\d+\.\d+\.\d+-custom\.\d+$') { throw "BundleVersion must look like 17.0.1-custom.1" }
if (-not $SkipExtensionBuild) {
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "Extension build failed." }
}

$extensionBinary = Join-Path $projectRoot "dist\message-nav-rail.mjs"
if (-not (Test-Path -LiteralPath $extensionBinary)) { throw "Extension bundle not found: $extensionBinary" }
$ohMyPiPackage = Get-Content -Raw -LiteralPath (Join-Path $OhMyPiRepo "packages\coding-agent\package.json") | ConvertFrom-Json
$extensionPackage = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$upstreamVersion = [string]$ohMyPiPackage.version
if (-not $BundleVersion.StartsWith("$upstreamVersion-custom.")) { throw "Bundle version $BundleVersion does not match Oh My Pi $upstreamVersion" }

$bundleName = "message-nav-rail-omp-$BundleVersion-windows-x64"
$stageDir = Join-Path $OutputRoot $bundleName
$zipPath = Join-Path $OutputRoot "$bundleName.zip"
if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir -Recurse -Force }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
New-Item -ItemType Directory -Path (Join-Path $stageDir "extension"), (Join-Path $stageDir "LICENSES") -Force | Out-Null

Copy-Item -LiteralPath $OmpBinary -Destination (Join-Path $stageDir "omp.exe")
Copy-Item -LiteralPath $extensionBinary -Destination (Join-Path $stageDir "extension\message-nav-rail.mjs")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "install-release.ps1") -Destination (Join-Path $stageDir "install.ps1")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "uninstall-release.ps1") -Destination (Join-Path $stageDir "uninstall.ps1")
Copy-Item -LiteralPath (Join-Path $OhMyPiRepo "LICENSE") -Destination (Join-Path $stageDir "LICENSES\oh-my-pi-LICENSE.txt")

$releasePackage = [ordered]@{
  name = "message-nav-rail"
  version = [string]$extensionPackage.version
  type = "module"
  main = "./message-nav-rail.mjs"
  exports = @{ "." = "./message-nav-rail.mjs" }
  omp = @{ extensions = @("./message-nav-rail.mjs") }
}
$releasePackage | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stageDir "extension\package.json") -Encoding UTF8

$sourceCommit = (& git -C $projectRoot rev-parse HEAD).Trim()
$ohMyPiCommit = (& git -C $OhMyPiRepo rev-parse HEAD).Trim()
$releasePatchSha256 = if ($ReleasePatch) { (Get-FileHash -LiteralPath (Resolve-Path -LiteralPath $ReleasePatch) -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
$manifest = [ordered]@{
  schemaVersion = 1
  bundleVersion = $BundleVersion
  upstreamVersion = $upstreamVersion
  extensionVersion = [string]$extensionPackage.version
  platform = "windows"
  architecture = "x64"
  officialBuild = $false
  sourceCommit = $sourceCommit
  ohMyPiCommit = $ohMyPiCommit
  ohMyPiBaseRef = if ($OhMyPiBaseRef) { $OhMyPiBaseRef } else { $ohMyPiCommit }
  releasePatchSha256 = $releasePatchSha256
  builtAt = (Get-Date).ToUniversalTime().ToString("o")
  nativeDistribution = "embedded-baseline-runtime-extraction"
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stageDir "manifest.json") -Encoding UTF8

@"
message-nav-rail 定制 Oh My Pi $BundleVersion

这是非官方定制构建，仅支持 Windows 10/11 x64（Intel/AMD x86-64）。

安装：
  powershell -ExecutionPolicy Bypass -File .\install.ps1

回滚/卸载：
  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RestorePrevious

安装前请关闭所有 omp.exe 进程。安装器会校验文件、备份当前版本并在失败时自动回滚。
"@ | Set-Content -LiteralPath (Join-Path $stageDir "README.txt") -Encoding UTF8

$hashFiles = Get-ChildItem -LiteralPath $stageDir -Recurse -File | Where-Object Name -ne "SHA256SUMS.txt" | Sort-Object FullName
$hashLines = foreach ($file in $hashFiles) {
  $relative = [System.IO.Path]::GetRelativePath($stageDir, $file.FullName).Replace("\", "/")
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $relative"
}
$hashLines | Set-Content -LiteralPath (Join-Path $stageDir "SHA256SUMS.txt") -Encoding ASCII
Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$zipHash  $([System.IO.Path]::GetFileName($zipPath))" | Set-Content -LiteralPath "$zipPath.sha256" -Encoding ASCII
Write-Host "Release package: $zipPath"
Write-Host "SHA-256: $zipHash"
