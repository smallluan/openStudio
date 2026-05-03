# Adds a Windows Defender folder exclusion for OpenClaw dev state (~/.openclaw-dev).
# Requires an elevated PowerShell on consumer Windows with Defender enabled.
# Safe to re-run; skips if the path is already excluded.

$ErrorActionPreference = "Stop"

if (-not ($env:OS -match "Windows_NT")) {
    Write-Host "[open-studio] Skip: not Windows."
    exit 0
}

$target = Join-Path $env:USERPROFILE ".openclaw-dev"
if (-not (Test-Path -LiteralPath $target)) {
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Write-Host "[open-studio] Created directory: $target"
}

try {
    $null = Get-Command Get-MpPreference -ErrorAction Stop
} catch {
    Write-Host "[open-studio] Windows Defender cmdlets unavailable (other AV or SKU). Manually exclude:"
    Write-Host "  $target"
    exit 0
}

try {
    $pref = Get-MpPreference -ErrorAction Stop
    $paths = @($pref.ExclusionPath | Where-Object { $_ })
    foreach ($p in $paths) {
        if ($p -eq $target) {
            Write-Host "[open-studio] Defender already excludes: $target"
            exit 0
        }
    }
} catch {
    Write-Host "[open-studio] Could not read Defender preferences: $($_.Exception.Message)"
    Write-Host "[open-studio] Try manually: Add-MpPreference -ExclusionPath '$target'"
    exit 1
}

try {
    Add-MpPreference -ExclusionPath $target
    Write-Host "[open-studio] Defender exclusion added: $target"
    exit 0
} catch {
    Write-Warning "[open-studio] Add-MpPreference failed (often requires Administrator PowerShell): $($_.Exception.Message)"
    Write-Host ""
    Write-Host "Right-click PowerShell → Run as administrator, then:"
    Write-Host "  Add-MpPreference -ExclusionPath '$target'"
    exit 1
}
