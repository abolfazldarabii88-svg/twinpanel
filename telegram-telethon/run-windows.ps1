$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Find-Python {
    foreach ($launcher in @("py", "python")) {
        $cmd = Get-Command $launcher -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        try {
            if ($launcher -eq "py") {
                $candidate = (& py -3 -c "import sys; print(sys.executable)" 2>$null | Select-Object -Last 1)
            } else {
                $candidate = (& python -c "import sys; print(sys.executable)" 2>$null | Select-Object -Last 1)
            }
            if ($LASTEXITCODE -eq 0 -and $candidate -and (Test-Path -LiteralPath $candidate.Trim())) {
                return $candidate.Trim()
            }
        } catch {}
    }
    return $null
}

$pythonExe = Find-Python
if (-not $pythonExe) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "Python was not found. Installing Python 3.12 for your Windows user..." -ForegroundColor Yellow
        & winget install --id Python.Python.3.12 --exact --scope user --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0) {
            $pythonExe = Join-Path $env:LocalAppData "Programs\Python\Python312\python.exe"
            if (-not (Test-Path -LiteralPath $pythonExe)) { $pythonExe = Find-Python }
        }
    }
}
if (-not $pythonExe -or -not (Test-Path -LiteralPath $pythonExe)) {
    Write-Host ""
    Write-Host "Python is not installed (or could not be installed automatically)." -ForegroundColor Red
    Write-Host "Install Python 3.12 from https://www.python.org/downloads/windows/ ." -ForegroundColor Yellow
    Write-Host "During setup, enable 'Add python.exe to PATH', finish installation, then run this file again."
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "Using Python: $pythonExe"
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Creating isolated Python environment..."
    & $pythonExe -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Could not create Python environment." }
}

$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
Write-Host "Installing/checking Telethon dependency..."
& $venvPython -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Could not install Telethon. Check your internet connection." }

$env:TELEGRAM_API_ID = Read-Host "Telegram API ID"
$secureHash = Read-Host "Telegram API HASH (input hidden)" -AsSecureString
$hashPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureHash)
try {
    $env:TELEGRAM_API_HASH = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($hashPointer)
    & $venvPython main.py
    $scriptExit = $LASTEXITCODE
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($hashPointer)
    Remove-Item Env:TELEGRAM_API_ID -ErrorAction SilentlyContinue
    Remove-Item Env:TELEGRAM_API_HASH -ErrorAction SilentlyContinue
}
if ($scriptExit -ne 0) {
    Write-Host "Test ended with exit code $scriptExit." -ForegroundColor Yellow
}
Read-Host "Press Enter to close"
exit $scriptExit
