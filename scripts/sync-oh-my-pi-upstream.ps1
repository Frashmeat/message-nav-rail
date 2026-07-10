param(
  [string]$Repo = "F:\WebCode\message-nav-rail\ohmypi\oh-my-pi-clean",
  [string]$Branch = "",
  [string]$UpstreamRemote = "upstream",
  [string]$OriginRemote = "origin",
  [string]$UpstreamBranch = "",
  [switch]$NoPush,
  [switch]$Verify,
  [switch]$SkipDepsInstall,
  [switch]$Build,
  [switch]$Deploy,
  [switch]$NoDeploy,
  [switch]$SkipExtensionInstall,
  [switch]$DryRun,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$script:CurrentStep = "initializing"
$script:ProjectRoot = Split-Path -Parent $PSScriptRoot

if ($Help) {
  @"
Sync local Oh My Pi fork branch with upstream and push to origin.

Usage:
  .\scripts\sync-oh-my-pi-upstream.ps1
  .\scripts\sync-oh-my-pi-upstream.ps1 -NoPush
  .\scripts\sync-oh-my-pi-upstream.ps1 -UpstreamBranch main
  .\scripts\sync-oh-my-pi-upstream.ps1 -Verify -SkipDepsInstall
  .\scripts\sync-oh-my-pi-upstream.ps1 -NoDeploy

Behavior:
  1. Requires a clean working tree.
  2. Fetches origin and upstream.
  3. Fast-forwards from origin/<branch> when possible.
  4. Merges upstream/<upstream-branch> into the local branch.
  5. If a normal sync problem occurs, stops at the failing step and prints the reason plus suggested commands.
  6. If no conflicts occur, pushes HEAD to origin/<branch> unless -NoPush is set.
  7. By default, builds and deploys the local omp.exe after sync. Use -NoDeploy to skip local OMP update.
  8. Optional: -Verify runs the local validation script before build/deploy.
"@ | Write-Host
  exit 0
}

function Write-Section {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Problem {
  param(
    [string]$Step,
    [string]$Problem,
    [string[]]$Suggestions = @(),
    [object[]]$Details = @()
  )

  Write-Host ""
  Write-Host "Sync failed at step: $Step" -ForegroundColor Red
  Write-Host "Problem: $Problem" -ForegroundColor Yellow
  if ($Details.Count -gt 0) {
    Write-Host ""
    Write-Host "Details:"
    $Details | ForEach-Object { Write-Host $_ }
  }
  if ($Suggestions.Count -gt 0) {
    Write-Host ""
    Write-Host "Suggested next steps:"
    $Suggestions | ForEach-Object { Write-Host "  $_" }
  }
}

function Exit-WithProblem {
  param(
    [int]$Code,
    [string]$Step,
    [string]$Problem,
    [string[]]$Suggestions = @(),
    [object[]]$Details = @()
  )

  Write-Problem -Step $Step -Problem $Problem -Suggestions $Suggestions -Details $Details
  exit $Code
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [switch]$AllowFailure
  )

  if ($DryRun) {
    Write-Host "[dry-run] git $($Arguments -join ' ')"
    return [pscustomobject]@{
      ExitCode = 0
      Output = @()
    }
  }

  $output = @()
  $exitCode = 0
  $previousErrorActionPreference = $ErrorActionPreference
  $previousNativeErrorPreference = $null
  $hasNativeErrorPreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
  try {
    $ErrorActionPreference = "Continue"
    if ($hasNativeErrorPreference) {
      $previousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
      $PSNativeCommandUseErrorActionPreference = $false
    }
    $output = & git @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } catch {
    $output = @($_.Exception.Message)
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
      $exitCode = 1
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    if ($hasNativeErrorPreference) {
      $PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
    }
  }
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    throw "git $($Arguments -join ' ') failed with exit code ${exitCode}`n$text"
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = @($output)
  }
}

function Get-GitOutput {
  param([string[]]$Arguments)
  if ($DryRun) {
    Write-Host "[dry-run] git $($Arguments -join ' ')"
    return @()
  }
  return ((& git @Arguments 2>$null) | ForEach-Object { $_.ToString() })
}

function Invoke-GitStep {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Step,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [string[]]$Suggestions = @()
  )

  $script:CurrentStep = $Step
  Write-Section $Step
  $result = Invoke-Git -Arguments $Arguments -AllowFailure
  if ($result.ExitCode -ne 0) {
    $details = @($result.Output | ForEach-Object { $_.ToString() })
    Exit-WithProblem -Code $result.ExitCode -Step $Step -Problem "Command failed: git $($Arguments -join ' ')" -Suggestions $Suggestions -Details $details
  }
  return $result
}

function Invoke-CommandStep {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Step,
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = $Repo,
    [string[]]$Suggestions = @()
  )

  $script:CurrentStep = $Step
  Write-Section $Step
  if ($DryRun) {
    Write-Host "[dry-run] $FilePath $($Arguments -join ' ')"
    return
  }

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      Exit-WithProblem -Code $exitCode -Step $Step -Problem "Command failed with exit code ${exitCode}: $FilePath $($Arguments -join ' ')" -Suggestions $Suggestions
    }
  } finally {
    Pop-Location
  }
}

function Test-RemoteExists {
  param([string]$Name)
  if ($DryRun) {
    return $true
  }
  $remotes = @(Get-GitOutput @("remote"))
  return $remotes -contains $Name
}

function Get-CurrentBranch {
  $branch = (Get-GitOutput @("branch", "--show-current") | Select-Object -First 1)
  if (-not $branch) {
    Exit-WithProblem -Code 2 -Step "detect local branch" -Problem "Current checkout is detached." -Suggestions @(
      "cd $Repo",
      "git branch",
      "git checkout message-nav-rail",
      "or rerun this script with -Branch <local-branch>"
    )
  }
  return $branch
}

function Get-UpstreamDefaultBranch {
  param([string]$Remote)

  $head = (Get-GitOutput @("symbolic-ref", "--quiet", "--short", "refs/remotes/$Remote/HEAD") | Select-Object -First 1)
  if ($head -and $head.StartsWith("$Remote/")) {
    return $head.Substring($Remote.Length + 1)
  }

  foreach ($candidate in @("main", "master")) {
    $exists = Invoke-Git -Arguments @("rev-parse", "--verify", "--quiet", "$Remote/$candidate") -AllowFailure
    if ($exists.ExitCode -eq 0) {
      return $candidate
    }
  }

  Exit-WithProblem -Code 2 -Step "detect upstream default branch" -Problem "Could not determine the default branch of remote '$Remote'." -Suggestions @(
    "cd $Repo",
    "git remote show $Remote",
    "rerun this script with -UpstreamBranch main or another existing upstream branch"
  )
}

function Assert-CleanWorktree {
  $status = @(Get-GitOutput @("status", "--porcelain"))
  if ($status.Count -eq 0) {
    return
  }

  Exit-WithProblem -Code 2 -Step "check clean working tree" -Problem "Oh My Pi working tree has uncommitted changes. Sync stopped before fetching or merging." -Suggestions @(
    "cd $Repo",
    "git status",
    "commit changes: git add <files>; git commit -m `"message-nav-rail: update local patch`"",
    "or temporarily save them: git stash push -u"
  ) -Details $status
}

function Test-MergeInProgress {
  $gitDir = (Get-GitOutput @("rev-parse", "--git-dir") | Select-Object -First 1)
  if (-not $gitDir) {
    return $false
  }
  return (Test-Path -LiteralPath (Join-Path $gitDir "MERGE_HEAD")) -or
    (Test-Path -LiteralPath (Join-Path $gitDir "rebase-merge")) -or
    (Test-Path -LiteralPath (Join-Path $gitDir "rebase-apply"))
}

function Show-ConflictHelp {
  param(
    [string]$LocalBranch,
    [string]$PushRemote
  )

  $conflicts = @(Get-GitOutput @("diff", "--name-only", "--diff-filter=U"))
  Exit-WithProblem -Code 3 -Step "merge upstream into local branch" -Problem "Git reported merge conflicts. The repository is left in merge state for manual resolution." -Suggestions @(
    "cd $Repo",
    "git status",
    "edit the conflicted files, then run: git add <resolved-files>",
    "finish merge: git merge --continue",
    "push result: git push $PushRemote HEAD:$LocalBranch",
    "or abort this sync attempt: git merge --abort"
  ) -Details $conflicts
}

if (-not (Test-Path -LiteralPath $Repo)) {
  Exit-WithProblem -Code 2 -Step "locate repository" -Problem "Oh My Pi repo was not found: $Repo" -Suggestions @(
    "check that the repo exists at $Repo",
    "or rerun with -Repo <path-to-oh-my-pi-clean>"
  )
}

Push-Location $Repo
try {
  Invoke-GitStep -Step "verify repository" -Arguments @("rev-parse", "--is-inside-work-tree") -Suggestions @(
    "cd $Repo",
    "confirm this directory is a Git repository"
  ) | Out-Null

  if (Test-MergeInProgress) {
    Exit-WithProblem -Code 2 -Step "check existing merge/rebase state" -Problem "A merge or rebase is already in progress." -Suggestions @(
      "cd $Repo",
      "git status",
      "continue the existing operation if intended",
      "or abort it with: git merge --abort",
      "if it is a rebase, abort it with: git rebase --abort"
    )
  }

  if (-not (Test-RemoteExists $OriginRemote)) {
    Exit-WithProblem -Code 2 -Step "check origin remote" -Problem "Remote '$OriginRemote' was not found." -Suggestions @(
      "cd $Repo",
      "git remote -v",
      "git remote add $OriginRemote https://github.com/Frashmeat/oh-my-pi.git"
    )
  }
  if (-not (Test-RemoteExists $UpstreamRemote)) {
    Exit-WithProblem -Code 2 -Step "check upstream remote" -Problem "Remote '$UpstreamRemote' was not found." -Suggestions @(
      "cd $Repo",
      "git remote -v",
      "git remote add $UpstreamRemote https://github.com/can1357/oh-my-pi.git"
    )
  }

  if (-not $Branch) {
    $Branch = Get-CurrentBranch
  }

  Assert-CleanWorktree

  Write-Section "sync plan"
  Write-Host "Syncing Oh My Pi repo: $Repo"
  Write-Host "Local branch: $Branch"
  Invoke-GitStep -Step "fetch origin" -Arguments @("fetch", "--prune", $OriginRemote) -Suggestions @(
    "check network access to GitHub",
    "cd $Repo",
    "git remote -v",
    "git fetch --prune $OriginRemote"
  ) | Out-Null
  Invoke-GitStep -Step "fetch upstream" -Arguments @("fetch", "--prune", $UpstreamRemote) -Suggestions @(
    "check network access to GitHub",
    "cd $Repo",
    "git remote -v",
    "git fetch --prune $UpstreamRemote"
  ) | Out-Null

  if (-not $UpstreamBranch) {
    $UpstreamBranch = Get-UpstreamDefaultBranch $UpstreamRemote
  }

  $upstreamRef = "$UpstreamRemote/$UpstreamBranch"
  Write-Host "Upstream ref: $upstreamRef"
  $upstreamExists = Invoke-Git -Arguments @("rev-parse", "--verify", "--quiet", $upstreamRef) -AllowFailure
  if ($upstreamExists.ExitCode -ne 0) {
    Exit-WithProblem -Code 2 -Step "check upstream ref" -Problem "Upstream ref '$upstreamRef' was not found." -Suggestions @(
      "cd $Repo",
      "git branch -r",
      "rerun with -UpstreamBranch main or another existing upstream branch"
    )
  }

  Invoke-GitStep -Step "checkout local branch" -Arguments @("checkout", $Branch) -Suggestions @(
    "cd $Repo",
    "git branch",
    "create the branch if missing: git checkout -b $Branch"
  ) | Out-Null

  $originRef = "$OriginRemote/$Branch"
  $originExists = Invoke-Git -Arguments @("rev-parse", "--verify", "--quiet", $originRef) -AllowFailure
  if ($originExists.ExitCode -eq 0) {
    Invoke-GitStep -Step "fast-forward from origin branch" -Arguments @("merge", "--ff-only", $originRef) -Suggestions @(
      "cd $Repo",
      "git status",
      "inspect divergence: git log --oneline --graph --decorate --left-right HEAD...$originRef",
      "if remote is correct, pull/rebase manually or reset only after confirming with: git reset --hard $originRef"
    ) | Out-Null
  } else {
    Write-Host "Origin branch $originRef does not exist yet; it will be created on push."
  }

  Write-Section "merge upstream into local branch"
  $mergeResult = Invoke-Git -Arguments @("merge", "--no-edit", $upstreamRef) -AllowFailure
  if ($mergeResult.ExitCode -ne 0) {
    Show-ConflictHelp $Branch $OriginRemote
    exit 3
  }

  if ($NoPush) {
    Write-Host "Sync finished without conflicts. Push skipped because -NoPush was set."
  } else {
    Invoke-GitStep -Step "push synced branch to origin" -Arguments @("push", $OriginRemote, "HEAD:$Branch") -Suggestions @(
      "check network access to GitHub",
      "check GitHub authentication for $OriginRemote",
      "cd $Repo",
      "retry manually: git push $OriginRemote HEAD:$Branch"
    ) | Out-Null
    Write-Host "Sync completed and pushed successfully."
  }
} catch {
  Write-Problem -Step $script:CurrentStep -Problem $_.Exception.Message -Suggestions @(
    "cd $Repo",
    "git status",
    "rerun with -DryRun to preview the normal command sequence"
  )
  exit 1
} finally {
  Pop-Location
}

if ($Verify) {
  $verifyArgs = @("-BuildNative")
  if ($SkipDepsInstall) {
    $verifyArgs += "-SkipDepsInstall"
  }
  $verifyCommandArgs = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Join-Path $PSScriptRoot "setup-oh-my-pi-bun-and-verify.ps1")
  ) + $verifyArgs
  Invoke-CommandStep -Step "verify Oh My Pi patch" -FilePath "powershell.exe" -Arguments $verifyCommandArgs -WorkingDirectory $script:ProjectRoot -Suggestions @(
    "cd $script:ProjectRoot",
    ".\scripts\verify-oh-my-pi.cmd -SkipDepsInstall",
    "if dependencies changed, rerun without -SkipDepsInstall"
  )
}

if ($Build -or -not $NoDeploy) {
  Invoke-CommandStep -Step "build local omp.exe" -FilePath "bun" -Arguments @("--cwd=packages/coding-agent", "run", "build") -WorkingDirectory $Repo -Suggestions @(
    "cd $Repo",
    "bun --cwd=packages/coding-agent run build",
    "if bun is not found, run .\scripts\verify-oh-my-pi.cmd from $script:ProjectRoot first"
  )
}

if (-not $NoDeploy) {
  $deployArgs = @()
  if ($SkipExtensionInstall) {
    $deployArgs += "-SkipExtensionInstall"
  }
  $deployCommandArgs = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Join-Path $PSScriptRoot "deploy-oh-my-pi-local.ps1")
  ) + $deployArgs
  Invoke-CommandStep -Step "deploy local omp.exe" -FilePath "powershell.exe" -Arguments $deployCommandArgs -WorkingDirectory $script:ProjectRoot -Suggestions @(
    "close running Oh My Pi sessions",
    "cd $script:ProjectRoot",
    ".\scripts\deploy-oh-my-pi-local.cmd"
  )
}
