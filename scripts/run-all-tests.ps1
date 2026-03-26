##############################################################################
# run-all-tests.ps1 — Mtiririko Comprehensive Test Suite Runner
#
# Runs every test phase in sequence and prints a final pass/fail summary.
#
# Usage:
#   .\scripts\run-all-tests.ps1
#   .\scripts\run-all-tests.ps1 -SkipLoad         # skip Node.js load tests
#   .\scripts\run-all-tests.ps1 -SkipContracts    # skip Hardhat contract tests
##############################################################################

param(
    [switch]$SkipLoad,
    [switch]$SkipContracts,
    [switch]$SkipJest
)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$sep = "=" * 70

# ── Result tracking ───────────────────────────────────────────────────────────
$results = @()

function Run-Phase {
    param([string]$Name, [string]$Cmd, [string]$WorkDir)

    Write-Host ""
    Write-Host $sep -ForegroundColor Cyan
    Write-Host "  PHASE: $Name" -ForegroundColor Cyan
    Write-Host $sep -ForegroundColor Cyan

    $start = Get-Date
    Push-Location $WorkDir
    Invoke-Expression $Cmd
    $exitCode = $LASTEXITCODE
    Pop-Location

    $elapsed = ((Get-Date) - $start).TotalSeconds

    $status = if ($exitCode -eq 0) { "PASSED" } else { "FAILED" }
    $color = if ($exitCode -eq 0) { "Green" } else { "Red" }

    Write-Host ""
    Write-Host "  [$status] $Name — ${elapsed}s" -ForegroundColor $color

    $script:results += [PSCustomObject]@{
        Phase    = $Name
        Status   = $status
        Elapsed  = [math]::Round($elapsed, 1)
        ExitCode = $exitCode
    }
}

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 1: Smart Contract Test Suite (Hardhat)
# ══════════════════════════════════════════════════════════════════════════════
if (-not $SkipContracts) {
    Run-Phase -Name "Smart Contract Security & Economic Tests (Hardhat)" -Cmd "npx hardhat test --reporter spec" -WorkDir "$Root\packages\contracts"
}
else {
    Write-Host "  [SKIPPED] Smart Contract Tests" -ForegroundColor Yellow
    $results += [PSCustomObject]@{ Phase = "Smart Contract Tests"; Status = "SKIPPED"; Elapsed = 0; ExitCode = 0 }
}

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2: Middleware Unit Tests (Jest)
# ══════════════════════════════════════════════════════════════════════════════
if (-not $SkipJest) {
    Run-Phase -Name "Middleware Unit Tests (Jest)" -Cmd "npx jest --verbose --forceExit" -WorkDir "$Root\apps\middleware"
}
else {
    Write-Host "  [SKIPPED] Jest Tests" -ForegroundColor Yellow
    $results += [PSCustomObject]@{ Phase = "Middleware Unit Tests"; Status = "SKIPPED"; Elapsed = 0; ExitCode = 0 }
}

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3: Load Test — 10× Traffic Spike
# ══════════════════════════════════════════════════════════════════════════════
if (-not $SkipLoad) {
    Write-Host ""
    Write-Host "  NOTE: Load tests require Redis running on localhost:6379" -ForegroundColor Yellow

    Run-Phase -Name "Load Test — 10× Traffic Spike (baseline=200 peak=2000 duration=20s)" -Cmd "node apps\testing\load-test.js --baseline 200 --peak 2000 --duration 20 --spikeAt 8" -WorkDir $Root

    # ── Phase 4: Batch Pipeline Latency ──────────────────────────────────────
    Run-Phase -Name "Batch Pipeline Latency Tracker (200 intents, 3 workers)" -Cmd "node apps\testing\batch-latency.js --intents 200 --batchSize 20 --workers 3" -WorkDir $Root

    # ── Phase 5: Relayer Performance ─────────────────────────────────────────
    Run-Phase -Name "Relayer Performance Benchmark (3 relayers, 300 intents)" -Cmd "node apps\testing\relayer-perf.js --relayers 3 --intents 300 --pauseSec 5 --batchSize 30" -WorkDir $Root

    # ── Phase 6: AML Simulation ───────────────────────────────────────────────
    Run-Phase -Name "AML Financial Crime Simulation" -Cmd "node apps\testing\aml-sim.js" -WorkDir $Root

    # ── Phase 7: Chaos Engineering ────────────────────────────────────────────
    Run-Phase -Name "Chaos Engineering Suite (MTTD measurement)" -Cmd "node apps\testing\chaos-monkey.js" -WorkDir $Root
}
else {
    Write-Host "  [SKIPPED] Load, Latency, Relayer, AML, and Chaos tests" -ForegroundColor Yellow
    @("Load Test", "Batch Latency", "Relayer Perf", "AML Sim", "Chaos Monkey") | ForEach-Object {
        $results += [PSCustomObject]@{ Phase = $_; Status = "SKIPPED"; Elapsed = 0; ExitCode = 0 }
    }
}

# ══════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host $sep -ForegroundColor Cyan
Write-Host "  MTIRIRIKO TEST SUITE — FINAL SUMMARY" -ForegroundColor Cyan
Write-Host $sep -ForegroundColor Cyan
Write-Host ""

$passed = ($results | Where-Object { $_.Status -eq "PASSED" }).Count
$failed = ($results | Where-Object { $_.Status -eq "FAILED" }).Count
$skipped = ($results | Where-Object { $_.Status -eq "SKIPPED" }).Count
$total = $results.Count

foreach ($r in $results) {
    $icon = switch ($r.Status) { "PASSED" { "✅" } "FAILED" { "❌" } "SKIPPED" { "⏭️ " } default { "?" } }
    $color = switch ($r.Status) { "PASSED" { "Green" } "FAILED" { "Red" } "SKIPPED" { "Yellow" } default { "White" } }
    Write-Host "  $icon  $($r.Phase.PadRight(55)) $($r.Status.PadRight(8)) $($r.Elapsed)s" -ForegroundColor $color
}

Write-Host ""
Write-Host "  $sep" -ForegroundColor Cyan
Write-Host ("  Total: {0} phases | Passed: {1} | Failed: {2} | Skipped: {3}" -f $total, $passed, $failed, $skipped)
Write-Host ""

if ($failed -gt 0) {
    Write-Host "  ❌ Test suite FAILED — $failed phase(s) require attention." -ForegroundColor Red
    exit 1
}
else {
    Write-Host "  ✅ All phases passed. Mtiririko test suite complete." -ForegroundColor Green
    exit 0
}
