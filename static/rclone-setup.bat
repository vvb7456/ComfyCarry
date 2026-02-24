@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: ComfyCarry Rclone Setup Helper
:: Pick cloud storage -> OAuth authorize -> export config
::
:: For OAuth remotes (OneDrive/GDrive/Dropbox):
::   Uses "rclone authorize" to get token (no drive discovery),
::   then writes config manually with the token.
:: For S3 remotes (R2/S3):
::   Uses "rclone config create" directly.
::
:: Note: Google Drive OAuth requires access to googleapis.com.
::   If blocked by network, use a proxy or VPN.
:: ============================================================================

title ComfyCarry - Rclone Setup Helper

set "RCLONE_EXE=%~dp0rclone.exe"
set "RCLONE_CONF=%~dp0rclone.conf"
set "TOKEN_FILE=%~dp0_token_tmp.txt"
set "TOKEN_LINE_FILE=%~dp0_tkn.txt"

echo.
echo  +==================================================+
echo  ^|   ComfyCarry - Rclone Setup Helper               ^|
echo  ^|                                                   ^|
echo  ^|   Setup cloud storage for ComfyUI workspace sync  ^|
echo  +==================================================+
echo.

:: -- Check rclone.exe exists in same directory --
if not exist "%RCLONE_EXE%" (
    echo  [!!] rclone.exe not found in same directory as this script.
    echo.
    echo      Expected location: %RCLONE_EXE%
    echo.
    echo      The zip downloaded from ComfyCarry should contain both
    echo      this .bat file and rclone.exe together.
    echo      Please re-download and extract the full zip.
    echo.
    goto :exit_pause
)

echo  [OK] rclone.exe found
echo.

:: ==============================================================
:: Main Menu
:: ==============================================================
:main_menu
echo.
echo  ==================================================
echo   Pick a cloud storage to configure:
echo  --------------------------------------------------
echo   [1] OneDrive
echo   [2] Google Drive
echo   [3] Cloudflare R2  (S3 compatible)
echo   [4] AWS S3
echo   [5] Dropbox
echo  --------------------------------------------------
echo   [0] Done - export config and exit
echo  ==================================================
echo.
set /p "CHOICE=  Enter number: "

if "!CHOICE!"=="1" goto :setup_onedrive
if "!CHOICE!"=="2" goto :setup_gdrive
if "!CHOICE!"=="3" goto :setup_r2
if "!CHOICE!"=="4" goto :setup_s3
if "!CHOICE!"=="5" goto :setup_dropbox
if "!CHOICE!"=="0" goto :export_config
echo  [!!] Invalid choice
goto :main_menu

:: ==============================================================
:: OneDrive  (rclone authorize -> manual config)
:: ==============================================================
:setup_onedrive
echo.
echo  -- OneDrive Setup ------------------------------------
echo.
set "REMOTE_NAME=onedrive"
set /p "REMOTE_NAME=  Remote name (default: onedrive): "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=onedrive"

echo.
echo  Account type:
echo    [1] Personal (OneDrive)
echo    [2] Business (OneDrive for Business)
echo.
set "OD_TYPE=1"
set /p "OD_TYPE=  Choose (default: 1): "
if "!OD_TYPE!"=="" set "OD_TYPE=1"

if "!OD_TYPE!"=="2" (
    set "OD_DRIVE_TYPE=business"
) else (
    set "OD_DRIVE_TYPE=personal"
)

echo.
echo  [..] Opening browser for OneDrive authorization...
echo      Sign in with your Microsoft account and grant access.
echo      After browser shows "Success", wait for token capture.
echo.

:: rclone authorize: only stdout captured, stderr shows in console
"%RCLONE_EXE%" authorize "onedrive" > "%TOKEN_FILE%"
set "AUTH_ERR=!errorlevel!"

if !AUTH_ERR! neq 0 (
    echo.
    echo  [!!] Authorization failed ^(exit code: !AUTH_ERR!^)
    del /q "%TOKEN_FILE%" >nul 2>&1
    goto :main_menu
)

:: Extract token JSON line using findstr on file
findstr /C:"access_token" "%TOKEN_FILE%" > "%TOKEN_LINE_FILE%" 2>nul
set /p "OD_TOKEN=" < "%TOKEN_LINE_FILE%"
del /q "%TOKEN_FILE%" >nul 2>&1
del /q "%TOKEN_LINE_FILE%" >nul 2>&1

if "!OD_TOKEN!"=="" (
    echo  [!!] Could not capture token. Try again.
    goto :main_menu
)

:: Write config manually - bypass drive discovery
>> "%RCLONE_CONF%" echo.
>> "%RCLONE_CONF%" echo [!REMOTE_NAME!]
>> "%RCLONE_CONF%" echo type = onedrive
>> "%RCLONE_CONF%" echo drive_type = !OD_DRIVE_TYPE!
>> "%RCLONE_CONF%" echo token = !OD_TOKEN!

echo.
echo  [OK] OneDrive configured ^(!OD_DRIVE_TYPE!^)
goto :create_folders

:: ==============================================================
:: Google Drive  (config create - interactive OAuth)
:: ==============================================================
:setup_gdrive
echo.
echo  -- Google Drive Setup --------------------------------
echo.
set "REMOTE_NAME=gdrive"
set /p "REMOTE_NAME=  Remote name (default: gdrive): "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=gdrive"

echo.
echo  [..] Starting Google Drive config...
echo.
echo  Rclone will ask a few questions. Quick guide:
echo    - client_id / client_secret: just press Enter
echo    - scope: type 1 and press Enter (full access)
echo    - service_account_file: just press Enter
echo    - Edit advanced config: type n
echo    - Use web browser: type y (browser will open)
echo    - After browser auth, come back here
echo    - Shared Drive (Team Drive): type n
echo    - Keep this remote: type y
echo.

"%RCLONE_EXE%" config create "!REMOTE_NAME!" drive --config "%RCLONE_CONF%"

if !errorlevel! neq 0 (
    echo.
    echo  [!!] Configuration failed. Try again.
    goto :main_menu
)

echo.
echo  [OK] Google Drive configured!
goto :create_folders

:: ==============================================================
:: Cloudflare R2  (direct config, no OAuth)
:: ==============================================================
:setup_r2
echo.
echo  -- Cloudflare R2 Setup -------------------------------
echo.
echo  Get these from Cloudflare Dashboard:
echo  R2 ^> Manage R2 API Tokens ^> Create API Token
echo.
set "REMOTE_NAME=r2"
set /p "REMOTE_NAME=  Remote name (default: r2): "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=r2"

set /p "R2_KEY=  Access Key ID: "
set /p "R2_SECRET=  Secret Access Key: "
set /p "R2_ENDPOINT=  Endpoint URL (e.g. https://xxx.r2.cloudflarestorage.com): "

if "!R2_KEY!"=="" (
    echo  [!!] Access Key cannot be empty
    goto :main_menu
)

echo.
echo  [..] Creating remote "!REMOTE_NAME!"...
"%RCLONE_EXE%" config create "!REMOTE_NAME!" s3 provider=Cloudflare access_key_id="!R2_KEY!" secret_access_key="!R2_SECRET!" endpoint="!R2_ENDPOINT!" --config "%RCLONE_CONF%"

echo  [..] Verifying connection...
"%RCLONE_EXE%" lsd "!REMOTE_NAME!:" --config "%RCLONE_CONF%" >nul 2>&1
if !errorlevel! equ 0 (
    echo  [OK] R2 connection verified!
) else (
    echo  [!!] Connection failed. Check your keys and endpoint.
    echo       Config saved - you can retry later.
)
goto :create_folders

:: ==============================================================
:: AWS S3  (direct config, no OAuth)
:: ==============================================================
:setup_s3
echo.
echo  -- AWS S3 Setup --------------------------------------
echo.
set "REMOTE_NAME=s3"
set /p "REMOTE_NAME=  Remote name (default: s3): "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=s3"

set /p "S3_KEY=  Access Key ID: "
set /p "S3_SECRET=  Secret Access Key: "
set "S3_REGION=us-east-1"
set /p "S3_REGION=  Region (default: us-east-1): "
if "!S3_REGION!"=="" set "S3_REGION=us-east-1"

if "!S3_KEY!"=="" (
    echo  [!!] Access Key cannot be empty
    goto :main_menu
)

echo.
echo  [..] Creating remote "!REMOTE_NAME!"...
"%RCLONE_EXE%" config create "!REMOTE_NAME!" s3 provider=AWS access_key_id="!S3_KEY!" secret_access_key="!S3_SECRET!" region="!S3_REGION!" --config "%RCLONE_CONF%"

echo  [OK] S3 configured!
goto :create_folders

:: ==============================================================
:: Dropbox  (rclone authorize -> manual config)
:: ==============================================================
:setup_dropbox
echo.
echo  -- Dropbox Setup -------------------------------------
echo.
set "REMOTE_NAME=dropbox"
set /p "REMOTE_NAME=  Remote name (default: dropbox): "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=dropbox"

echo.
echo  [..] Opening browser for Dropbox authorization...
echo      Sign in with your Dropbox account and grant access.
echo      After browser shows "Success", wait for token capture.
echo.

"%RCLONE_EXE%" authorize "dropbox" > "%TOKEN_FILE%"
set "AUTH_ERR=!errorlevel!"

if !AUTH_ERR! neq 0 (
    echo.
    echo  [!!] Authorization failed ^(exit code: !AUTH_ERR!^)
    del /q "%TOKEN_FILE%" >nul 2>&1
    goto :main_menu
)

findstr /C:"access_token" "%TOKEN_FILE%" > "%TOKEN_LINE_FILE%" 2>nul
set /p "DB_TOKEN=" < "%TOKEN_LINE_FILE%"
del /q "%TOKEN_FILE%" >nul 2>&1
del /q "%TOKEN_LINE_FILE%" >nul 2>&1

if "!DB_TOKEN!"=="" (
    echo  [!!] Could not capture token. Try again.
    goto :main_menu
)

>> "%RCLONE_CONF%" echo.
>> "%RCLONE_CONF%" echo [!REMOTE_NAME!]
>> "%RCLONE_CONF%" echo type = dropbox
>> "%RCLONE_CONF%" echo token = !DB_TOKEN!

echo.
echo  [OK] Dropbox configured!
goto :create_folders

:: ==============================================================
:: Create remote folders
:: ==============================================================
:create_folders
echo.
set /p "CREATE_FOLDERS=  Create ComfyUI sync folders on !REMOTE_NAME!? (y/n): "
if /i "!CREATE_FOLDERS!" neq "y" goto :folder_done

set "FOLDER_NAME=ComfyUI_Sync"
set /p "FOLDER_NAME=  Root folder name (default: ComfyUI_Sync): "
if "!FOLDER_NAME!"=="" set "FOLDER_NAME=ComfyUI_Sync"

echo  [..] Creating folders...

"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!FOLDER_NAME!/workflow" --config "%RCLONE_CONF%" 2>nul
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!FOLDER_NAME!/models" --config "%RCLONE_CONF%" 2>nul
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!FOLDER_NAME!/output" --config "%RCLONE_CONF%" 2>nul
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!FOLDER_NAME!/wildcards" --config "%RCLONE_CONF%" 2>nul

echo.
echo  [OK] Created folders:
echo       !REMOTE_NAME!:!FOLDER_NAME!/workflow    - workflows
echo       !REMOTE_NAME!:!FOLDER_NAME!/models      - models
echo       !REMOTE_NAME!:!FOLDER_NAME!/output      - generated images
echo       !REMOTE_NAME!:!FOLDER_NAME!/wildcards   - wildcards

:folder_done
echo.
echo  --------------------------------------------------
echo  Add more storage or enter 0 to finish.
goto :main_menu

:: ==============================================================
:: Export config
:: ==============================================================
:export_config
echo.

if not exist "%RCLONE_CONF%" (
    echo  [!!] No config file found. Add at least one remote first.
    goto :main_menu
)

echo  ==================================================
echo   [OK] Setup complete!
echo  --------------------------------------------------
echo.
echo   Configured remotes:
"%RCLONE_EXE%" listremotes --config "%RCLONE_CONF%"
echo.
echo  --------------------------------------------------
echo   Config file saved to:
echo.
echo     %RCLONE_CONF%
echo.
echo  --------------------------------------------------
echo   Next steps:
echo     1. Go back to ComfyCarry Setup Wizard
echo     2. In "Cloud Storage" step, choose "Upload File"
echo     3. Upload the rclone.conf file above
echo  ==================================================
echo.

:: Open folder and select the config file
explorer /select,"%RCLONE_CONF%"

:exit_pause
echo.
echo  Press any key to exit...
pause >nul
exit /b 0
