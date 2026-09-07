@echo off
rem 一键重新打包 APK: 先同步 prototype 里的 H5 到 assets, 再 gradle 出包。
rem release 包已开 R8 minify + shrinkResources(体积最小), 装这个。
chcp 65001 >nul
cd /d %~dp0
setlocal

set "ROOT=%~dp0.."
set "JAVA_HOME=%ROOT%toolchain\jdk"
set "GRADLE=%ROOT%toolchain\gradle\bin\gradle.bat"
set "SRC=%ROOT%prototype"
set "DST=%ROOT%android\app\src\main\assets\www"

echo == 1/3 同步 H5 资源 (prototype -^> assets/www) ==
if not exist "%DST%" mkdir "%DST%"
copy /Y "%SRC%\index.html" "%DST%\" >nul
copy /Y "%SRC%\style.css"  "%DST%\" >nul
copy /Y "%SRC%\app.js"     "%DST%\" >nul
echo done.

echo == 2/3 Gradle assembleRelease (R8 压缩) ==
call "%GRADLE%" --no-daemon --console=plain assembleRelease
if errorlevel 1 (
  echo.
  echo BUILD FAILED - 见上方报错
  exit /b 1
)

echo == 3/3 输出 APK(装这个) ==
dir /b "%ROOT%\android\app\build\outputs\apk\release\*.apk" 2>nul
endlocal
