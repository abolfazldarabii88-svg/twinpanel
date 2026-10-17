$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$pythonCommand = Get-Command py -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
}
if (-not $pythonCommand) {
    Write-Host "Python 3.10+ is required. Install it from https://www.python.org/downloads/windows/ and enable the Python launcher." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Creating isolated Python environment..."
    if ($pythonCommand.Name -eq "py") {
        & py -3 -m venv .venv
    } else {
        & python -m venv .venv
    }
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
