Unicode true
!include "MUI2.nsh"

!ifndef APP_VERSION
  !error "APP_VERSION is required"
!endif
!ifndef APP_SOURCE
  !error "APP_SOURCE is required"
!endif
!ifndef OUT_FILE
  !error "OUT_FILE is required"
!endif
!ifndef ICON_FILE
  !error "ICON_FILE is required"
!endif

Name "Animo ${APP_VERSION}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Animo"
InstallDirRegKey HKCU "Software\Animo" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show
!define MUI_ICON "${ICON_FILE}"
!define MUI_UNICON "${ICON_FILE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${APP_SOURCE}\*"
  WriteUninstaller "$INSTDIR\Uninstall Animo.exe"

  CreateDirectory "$SMPROGRAMS\Animo"
  CreateShortCut "$SMPROGRAMS\Animo\Animo.lnk" "$INSTDIR\Animo.exe" "" "$INSTDIR\Animo.exe"
  CreateShortCut "$SMPROGRAMS\Animo\Uninstall Animo.lnk" "$INSTDIR\Uninstall Animo.exe"
  CreateShortCut "$DESKTOP\Animo.lnk" "$INSTDIR\Animo.exe" "" "$INSTDIR\Animo.exe"

  WriteRegStr HKCU "Software\Animo" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo" "DisplayName" "Animo"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo" "Publisher" "Animo"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo" "DisplayIcon" "$INSTDIR\Animo.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo" "UninstallString" "$\"$INSTDIR\Uninstall Animo.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo" "QuietUninstallString" "$\"$INSTDIR\Uninstall Animo.exe$\" /S"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Animo.lnk"
  Delete "$SMPROGRAMS\Animo\Animo.lnk"
  Delete "$SMPROGRAMS\Animo\Uninstall Animo.lnk"
  RMDir "$SMPROGRAMS\Animo"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Animo"
  DeleteRegKey HKCU "Software\Animo"
  RMDir /r "$INSTDIR"
SectionEnd
