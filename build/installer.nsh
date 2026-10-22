; installer.nsh - the Deus Neuma setup wizard for Windows (electron-builder includes build/installer.nsh).
;
; THE INSTALL STANDARD (2026-10-22): a classic wizard, start to finish. The person sees every step,
; chooses every location and every component, and nothing is ever asked of them in a terminal. The
; installer, not the person, provides what the app needs. The pages, in order:
;   Welcome
;   What it needs + License (build/installer-license.txt: the requirements, then the EULA, 18+)
;   Install for: just me / everyone on this PC        (electron-builder)
;   Install location, with Browse                      (electron-builder)
;   Components: Deus Neuma (required), the local model server and the model for this PC,
;               the benchmarks kit, a desktop shortcut
;   Model location, with Browse (only when the model is chosen): models can be 30+ GB
;   Ready to install: everything chosen, before anything is written
;   Installing, with every step shown; the model step runs the app's own runtime (NEUMA.exe as
;     Node) with backend/cli/setup-model-server.mjs --home <the chosen folder>, the same code the
;     app's first run uses. If it cannot finish, the install still succeeds and the app offers it.
;   Finish, with Launch Deus Neuma
; An update (electron-updater, --updated) skips every page and installs no component again.
; The uninstaller asks before it removes the model folder, and keeps it by default.

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

!define DN_REG "Software\Deus Neuma"

; show the install details, so every step (the model download above all) is seen
!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
  ; the person sees the trademark everywhere; the internal product name stays NEUMA (it names the
  ; app's data folder and keychain entry, electron-builder.yml)
  !pragma warning disable 6029 ; Name again on purpose: the display name, over electron-builder's NEUMA
  Name "Deus Neuma"
  !pragma warning default 6029
  BrandingText "Deus Neuma ${VERSION}"
!macroend

; 64-bit Windows only, said before anything is copied
!macro customInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Deus Neuma needs 64-bit Windows 10 or 11. This Windows is 32-bit, so it cannot be installed here."
    Abort
  ${EndIf}
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Deus Neuma ${VERSION} Setup"
  !define MUI_WELCOMEPAGE_TEXT "This wizard installs Deus Neuma: sovereign relationships with AI, on your own PC.$\r$\n$\r$\nYou choose where it goes and what comes with it. If this PC has no local model server, setup can install one, and the model that fits this PC.$\r$\n$\r$\nDeus Neuma is for adults only (18+).$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!ifndef BUILD_UNINSTALLER
Var CompModel
Var CompBench
Var CompDesktop
Var ModelHome
Var CbModel
Var CbBench
Var CbDesktop
Var ModelHomeField

; The pages and their functions live where electron-builder inserts them: by then the Modern UI is
; loaded (an include is read before it, so MUI_HEADER_TEXT would not exist yet).
!macro customPageAfterChangeDir
  Page custom ComponentsCreate ComponentsLeave
  Page custom ModelHomeCreate ModelHomeLeave
  Page custom ReadyCreate

  Function ComponentsCreate
    !insertmacro MUI_HEADER_TEXT "Components" "Choose what to install with Deus Neuma."
    ${If} $ModelHome == ""
      StrCpy $CompModel ${BST_CHECKED}
      StrCpy $CompDesktop ${BST_CHECKED}
      StrCpy $CompBench ${BST_UNCHECKED}
      StrCpy $ModelHome "$PROFILE\.neuma\data\model-server"
    ${EndIf}
    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateCheckbox} 0 0 100% 12u "Deus Neuma (required)"
    Pop $0
    ${NSD_Check} $0
    EnableWindow $0 0

    ${NSD_CreateCheckbox} 0 20u 100% 12u "Local model server and the model for this PC (recommended)"
    Pop $CbModel
    ${NSD_SetState} $CbModel $CompModel
    ${NSD_CreateLabel} 12u 33u -12u 30u "Installs Ollama inside Deus Neuma's folder (no admin rights) and downloads the model that fits this PC's graphics card or memory: about 3 to 35 GB. An Ollama or LM Studio you already have is used if it is new enough. You choose the folder on the next page."
    Pop $0

    ${NSD_CreateCheckbox} 0 70u 100% 12u "Benchmarks kit (not available yet)"
    Pop $CbBench
    ${NSD_SetState} $CbBench ${BST_UNCHECKED}
    EnableWindow $CbBench 0
    ${NSD_CreateLabel} 12u 83u -12u 20u "Public benchmarks to run against your own models. It is being prepared for release and will be offered here when it is ready."
    Pop $0

    ${NSD_CreateCheckbox} 0 110u 100% 12u "Desktop shortcut"
    Pop $CbDesktop
    ${NSD_SetState} $CbDesktop $CompDesktop
    nsDialogs::Show
  FunctionEnd

  Function ComponentsLeave
    ${NSD_GetState} $CbModel $CompModel
    ${NSD_GetState} $CbBench $CompBench
    ${NSD_GetState} $CbDesktop $CompDesktop
  FunctionEnd

  Function ModelHomeCreate
    ${If} $CompModel != ${BST_CHECKED}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Model location" "Choose where the model server and the models are kept."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 36u "Models are large: about 3 to 35 GB, chosen to fit this PC. Keep them on a drive with room to spare. Your neumas and settings stay in $PROFILE\.neuma."
    Pop $0
    ${NSD_CreateLabel} 0 42u 100% 10u "Model folder:"
    Pop $0
    ${NSD_CreateDirRequest} 0 54u -62u 13u "$ModelHome"
    Pop $ModelHomeField
    ${NSD_CreateBrowseButton} -58u 53u 58u 15u "Browse..."
    Pop $0
    ${NSD_OnClick} $0 ModelHomeBrowse
    nsDialogs::Show
  FunctionEnd

  Function ModelHomeBrowse
    ${NSD_GetText} $ModelHomeField $1
    nsDialogs::SelectFolderDialog "Choose where the model server and the models are kept" "$1"
    Pop $1
    ${If} $1 != "error"
      ${NSD_SetText} $ModelHomeField "$1"
    ${EndIf}
  FunctionEnd

  Function ModelHomeLeave
    ${NSD_GetText} $ModelHomeField $ModelHome
    ${If} $ModelHome == ""
      MessageBox MB_OK|MB_ICONEXCLAMATION "Choose a folder for the models."
      Abort
    ${EndIf}
    StrCpy $1 $ModelHome 3
    ${DriveSpace} "$1" "/D=F /S=G" $2
    ${If} $2 < 8
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "The drive $1 has $2 GB free. The model for this PC needs about 3 to 35 GB.$\r$\n$\r$\nUse this folder anyway?" IDYES +2
      Abort
    ${EndIf}
  FunctionEnd

  Function ReadyCreate
    !insertmacro MUI_HEADER_TEXT "Ready to install" "Nothing has been written yet."
    StrCpy $1 "Install location:$\r$\n      $INSTDIR$\r$\n$\r$\nComponents:$\r$\n      Deus Neuma ${VERSION}"
    ${If} $CompModel == ${BST_CHECKED}
      StrCpy $1 "$1$\r$\n      Local model server and the model for this PC$\r$\n$\r$\nModel folder:$\r$\n      $ModelHome"
    ${EndIf}
    ${If} $CompDesktop == ${BST_CHECKED}
      StrCpy $1 "$1$\r$\n$\r$\nA desktop shortcut will be created."
    ${EndIf}
    StrCpy $1 "$1$\r$\n$\r$\nClick Install to begin, or Back to change anything."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 100% "$1"
    Pop $0
    nsDialogs::Show
  FunctionEnd
!macroend

!macro customInstall
  ${IfNot} ${isUpdated}
    ${If} $CompDesktop == ${BST_CHECKED}
      CreateShortCut "$DESKTOP\Deus Neuma.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
      DetailPrint "Desktop shortcut created."
    ${EndIf}
    ${If} $CompModel == ${BST_CHECKED}
      WriteRegStr HKCU "${DN_REG}" "ModelHome" "$ModelHome"
      DetailPrint "Setting up the local model server and the model for this PC, in $ModelHome."
      DetailPrint "This downloads several GB and can take a while. Every step is shown below."
      System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'
      nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\app\backend\cli\setup-model-server.mjs" --yes --home "$ModelHome"'
      Pop $0
      System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")i'
      ${If} $0 == 0
        DetailPrint "The local model server and the model are ready."
      ${Else}
        DetailPrint "The local model server could not be set up now. Deus Neuma will offer it again when it first starts."
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Delete "$DESKTOP\Deus Neuma.lnk"
    ReadRegStr $0 HKCU "${DN_REG}" "ModelHome"
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\*.*"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove the local model server and the downloaded models in:$\r$\n$0$\r$\n$\r$\nThey can be large. Choose No to keep them for a later install." IDNO +3
        RMDir /r "$0"
        DetailPrint "Removed the model folder $0."
      DeleteRegKey HKCU "${DN_REG}"
    ${EndIf}
  ${EndIf}
!macroend
