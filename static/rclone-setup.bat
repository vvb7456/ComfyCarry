@echo off
setlocal enabledelayedexpansion

:: 尝试设置 UTF-8 编码
chcp 65001 >nul 2>&1

:: ============================================================================
:: ComfyCarry Rclone 配置助手 (Regex 修复版)
:: ============================================================================

title ComfyCarry - Rclone 配置助手

set "RCLONE_EXE=%~dp0rclone.exe"
set "RCLONE_CONF=%~dp0rclone.conf"
set "TOKEN_FILE=%temp%\cc_tkn_tmp.txt"

echo.
echo  +==================================================+
echo  ^|   ComfyCarry - Rclone 配置助手               ^|
echo  ^|                                                   ^|
echo  ^|   为 ComfyUI 工作空间同步设置云存储            ^|
echo  +==================================================+
echo.

if not exist "%RCLONE_EXE%" (
    echo  [!!] 未找到 rclone.exe。请将其放在脚本同级目录下。
    goto :exit_pause
)

:: ==============================================================
:: 代理设置引导
:: ==============================================================
echo.
echo  [步骤 1/2] 网络代理设置
echo  --------------------------------------------------
echo  如果配置 Google Drive 或 Dropbox，建议设置代理。
echo.
set "USER_PROXY="
set /p "USER_PROXY=  请输入代理地址 (示例: http://127.0.0.1:7890 直接回车跳过): "

if not "!USER_PROXY!"=="" (
    set "HTTP_PROXY=!USER_PROXY!"
    set "HTTPS_PROXY=!USER_PROXY!"
    echo  [OK] 已设置代理: !USER_PROXY!
) else (
    echo  [OK] 未设置代理 ^(直连模式^)。
)
echo.

:: ==============================================================
:: 主菜单
:: ==============================================================
:main_menu
echo.
echo  [步骤 2/2] 云存储配置
echo  ==================================================
echo   请选择要配置的云存储:
echo  --------------------------------------------------
echo   [1] OneDrive
echo   [2] Google Drive
echo   [3] Dropbox
echo   [4] WebDAV (如 坚果云/群晖/AList)
echo   [5] Cloudflare R2 / S3 兼容
echo   [6] AWS S3
echo  --------------------------------------------------
echo   [0] 完成 - 导出配置并退出
echo  ==================================================
echo.
set "CHOICE="
set /p "CHOICE=  请输入选项数字: "

if "!CHOICE!"=="1" goto :setup_onedrive
if "!CHOICE!"=="2" goto :setup_gdrive
if "!CHOICE!"=="3" goto :setup_dropbox
if "!CHOICE!"=="4" goto :setup_webdav
if "!CHOICE!"=="5" goto :setup_r2
if "!CHOICE!"=="6" goto :setup_s3
if "!CHOICE!"=="0" goto :export_config
echo  [!!] 无效选择
goto :main_menu

:: ==============================================================
:: OneDrive
:: ==============================================================
:setup_onedrive
echo.
echo  -- OneDrive 设置 ------------------------------------
set "REMOTE_NAME=onedrive"
set /p "REMOTE_NAME=  配置名称 (默认: onedrive): "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=onedrive"

set "OD_TYPE=1"
set /p "OD_TYPE=  账户类型: [1] 个人版 [2] 商业版 (默认 1): "
if "!OD_TYPE!"=="2" (set "OD_DT=business") else (set "OD_DT=personal")

echo.
echo  [..] 正在打开浏览器授权...
:: 清理残留 rclone 进程，避免端口冲突
taskkill /f /im rclone.exe >nul 2>&1
timeout /t 1 >nul 2>&1
if exist "%TOKEN_FILE%" del /q "%TOKEN_FILE%"

"%RCLONE_EXE%" authorize "onedrive" > "%TOKEN_FILE%"
if errorlevel 1 (
    echo  [!!] rclone authorize 失败，请检查网络或重试。
    goto :main_menu
)

:: ================================================================
:: 关键修复: PowerShell 直接读取 token 文件并写入配置
:: 避免 batch enabledelayedexpansion 将 token 中的 ! 字符当作变量解析
:: (Microsoft refresh_token 常含 ! 字符, 经 batch 处理后会被截断/损坏)
:: ================================================================
echo  [..] 正在获取 OneDrive Drive ID...
set "DRIVE_ID="
for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$c=Get-Content -Raw $env:TOKEN_FILE; $m=[regex]::Match($c,'(?s)\{.*""access_token"".*\}'); if(-not $m.Success){Write-Output 'FAIL'; exit}; $tk=$m.Value; $di=''; try{$j=ConvertFrom-Json $tk; $h=@{Authorization=""Bearer $($j.access_token)""}; $r=Invoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/me/drive' -Headers $h -EA Stop; $di=$r.id}catch{}; $nl=[Environment]::NewLine; $cf=$env:RCLONE_CONF; [IO.File]::AppendAllText($cf, $nl+""[$env:REMOTE_NAME]""+$nl+""type = onedrive""+$nl+""drive_type = $env:OD_DT""+$nl+""token = $tk""+$nl); if($di){[IO.File]::AppendAllText($cf, ""drive_id = $di""+$nl)}; Write-Output $di"`) do set "DRIVE_ID=%%R"

del "%TOKEN_FILE%" >nul 2>&1

if "!DRIVE_ID!"=="FAIL" (
    echo  [!!] 无法捕获 Token，请检查浏览器是否授权成功。
    set "DRIVE_ID="
    goto :main_menu
)

if "!DRIVE_ID!"=="" (
    echo  [!!] 获取 Drive ID 失败，配置将不含 drive_id，使用前需手动补充。
    echo  [OK] OneDrive 配置已写入 ^(缺少 drive_id^)
) else (
    echo  [OK] OneDrive 配置已完成 ^(drive_id: !DRIVE_ID!^)
)

echo.
goto :create_folders

:: ==============================================================
:: Google Drive
:: ==============================================================
:setup_gdrive
echo.
echo  -- Google Drive 设置 --------------------------------
set "REMOTE_NAME=gdrive"
set /p "REMOTE_NAME=  配置名称 (默认: gdrive): "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=gdrive"

echo.
"%RCLONE_EXE%" config create "!REMOTE_NAME!" drive --config "%RCLONE_CONF%"

echo.
echo  [OK] Google Drive 配置完成。
goto :create_folders

:: ==============================================================
:: Dropbox
:: ==============================================================
:setup_dropbox
echo.
echo  -- Dropbox 设置 -------------------------------------
set "REMOTE_NAME=dropbox"
set /p "REMOTE_NAME=  配置名称 (默认: dropbox): "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=dropbox"

echo.
echo  [..] 正在打开浏览器授权...
taskkill /f /im rclone.exe >nul 2>&1
timeout /t 1 >nul 2>&1
if exist "%TOKEN_FILE%" del /q "%TOKEN_FILE%"

"%RCLONE_EXE%" authorize "dropbox" > "%TOKEN_FILE%"
if errorlevel 1 (
    echo  [!!] rclone authorize 失败，请检查网络或重试。
    goto :main_menu
)

:: PowerShell 直接读取 token 文件并写入配置 (同 OneDrive 修复)
set "PS_RESULT="
for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$c=Get-Content -Raw $env:TOKEN_FILE; $m=[regex]::Match($c,'(?s)\{.*""access_token"".*\}'); if(-not $m.Success){Write-Output 'FAIL'; exit}; $tk=$m.Value; $nl=[Environment]::NewLine; $cf=$env:RCLONE_CONF; [IO.File]::AppendAllText($cf, $nl+""[$env:REMOTE_NAME]""+$nl+""type = dropbox""+$nl+""token = $tk""+$nl); Write-Output 'OK'"`) do set "PS_RESULT=%%R"

del "%TOKEN_FILE%" >nul 2>&1

if "!PS_RESULT!"=="FAIL" (
    echo  [!!] 无法捕获 Token。
    goto :main_menu
)

if "!PS_RESULT!"=="OK" (
    echo  [OK] Dropbox 配置已完成。
) else (
    echo  [!!] Token 处理异常。
    goto :main_menu
)
goto :create_folders

:: ==============================================================
:: WebDAV
:: ==============================================================
:setup_webdav
echo.
echo  -- WebDAV 设置 --------------------------------------
set "REMOTE_NAME=webdav"
set /p "REMOTE_NAME=  配置名称: "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=webdav"

set /p "W_URL=  URL (如 https://dav.jianguoyun.com/dav/): "
set /p "W_USER=  用户名: "
set /p "W_PASS=  密码/应用密钥: "

echo.
echo  [提示] 正在创建 WebDAV 配置...
"%RCLONE_EXE%" config create "!REMOTE_NAME!" webdav url="!W_URL!" user="!W_USER!" pass="!W_PASS!" --config "%RCLONE_CONF%"

echo.
echo  [OK] WebDAV 配置完成。
goto :create_folders

:: ==============================================================
:: S3 / R2
:: ==============================================================
:setup_r2
echo.
echo  -- Cloudflare R2 设置 -------------------------------
set "REMOTE_NAME=r2"
set /p "REMOTE_NAME=  配置名称: "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=r2"
set /p "R2_KEY=  Access Key ID: "
set /p "R2_SECRET=  Secret Access Key: "
set /p "R2_ENDPOINT=  Endpoint URL: "

"%RCLONE_EXE%" config create "!REMOTE_NAME!" s3 provider=Cloudflare access_key_id="!R2_KEY!" secret_access_key="!R2_SECRET!" endpoint="!R2_ENDPOINT!" --config "%RCLONE_CONF%"
goto :create_folders

:setup_s3
echo.
echo  -- AWS S3 设置 --------------------------------------
set "REMOTE_NAME=s3"
set /p "REMOTE_NAME=  配置名称: "
if "!REMOTE_NAME!"=="" set "REMOTE_NAME=s3"
set /p "S3_KEY=  Access Key ID: "
set /p "S3_SECRET=  Secret Access Key: "
set /p "S3_REGION=  Region: "

"%RCLONE_EXE%" config create "!REMOTE_NAME!" s3 provider=AWS access_key_id="!S3_KEY!" secret_access_key="!S3_SECRET!" region="!S3_REGION!" --config "%RCLONE_CONF%"
goto :create_folders

:: ==============================================================
:: 目录初始化 (与 ComfyCarry Sync 模板一致)
:: ==============================================================
:create_folders
echo.
set /p "CONFIRM=  是否在该存储上初始化 ComfyUI 同步目录结构? (y/n): "
if /i "!CONFIRM!" neq "y" goto :main_menu

set "ROOT=comfyui-assets"
set /p "ROOT=  根目录名称 (默认: comfyui-assets): "
if "!ROOT!"=="" set "ROOT=comfyui-assets"

echo  [..] 正在创建完整目录结构 (请稍候)...

:: 基础目录 (与 SYNC_RULE_TEMPLATES 对应)
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/workflow" --config "%RCLONE_CONF%"
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/input" --config "%RCLONE_CONF%"
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/wildcards" --config "%RCLONE_CONF%"

:: Models 子目录 (遵照 ComfyUI 标准目录名称)
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/checkpoints" --config "%RCLONE_CONF%"
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/loras" --config "%RCLONE_CONF%"
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/vae" --config "%RCLONE_CONF%"
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/controlnet" --config "%RCLONE_CONF%"
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/embeddings" --config "%RCLONE_CONF%"
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/upscale" --config "%RCLONE_CONF%"
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/clip" --config "%RCLONE_CONF%"
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/clip_vision" --config "%RCLONE_CONF%"
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:!ROOT!/unet" --config "%RCLONE_CONF%"

:: 输出目录 (独立于 comfyui-assets)
"%RCLONE_EXE%" mkdir "!REMOTE_NAME!:ComfyUI_Output" --config "%RCLONE_CONF%"

echo.
echo  [OK] ComfyUI 标准目录结构已准备就绪。
echo       comfyui-assets/  workflow, input, wildcards,
echo                        checkpoints, loras, vae, controlnet,
echo                        embeddings, upscale, clip, clip_vision, unet
echo       ComfyUI_Output/
goto :main_menu

:: ==============================================================
:: 导出
:: ==============================================================
:export_config
echo.
if not exist "%RCLONE_CONF%" (
    echo  [!!] 未发现配置。
    goto :main_menu
)

echo  ==================================================
echo   [OK] 配置成功完成！
echo  --------------------------------------------------
echo   当前配置文件中的远程存储:
"%RCLONE_EXE%" listremotes --config "%RCLONE_CONF%"
echo.
echo   配置文件路径: %RCLONE_CONF%
echo  ==================================================
explorer /select,"%RCLONE_CONF%"

:exit_pause
echo.
pause
exit /b 0
