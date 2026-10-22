; installer.nsh - the Windows setup wizard provides what Deus Neuma needs (electron-builder includes
; build/installer.nsh in the NSIS installer).
;
; THE INSTALL STANDARD (2026-10-22): an installer checks the machine, says what is missing, and installs
; it, start to finish, with no commands. The pages, in order:
;   1. the agreement: what the app needs, then the EULA (build/installer-license.txt)
;   2. where to install
;   3. LOCAL MODEL: set up the model server and the model for this PC (checked by default)
;   4. install: the app's files, then, when 3 is checked, the model server step, run by the app's
;      own runtime (NEUMA.exe as Node) with backend/cli/setup-model-server.mjs, the same code the
;      app's first run uses: the pinned Ollama checked against its SHA-256, kept in the user's own
;      .neuma folder with no admin rights, and the model chosen for this PC. Its progress is shown.
;      If it cannot finish, the install still succeeds and the app offers the step on first run.

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

; show the install details, so the model server step's progress is seen, not a frozen bar
!macro customHeader
  ShowInstDetails show
!macroend

; 64-bit Windows only, said before anything is copied
!macro customInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Deus Neuma needs 64-bit Windows 10 or 11. This Windows is 32-bit, so it cannot be installed here."
    Abort
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
Var ModelCheckbox
Var SetupModel

; The page and its functions are defined where electron-builder inserts the page: by then the
; Modern UI is loaded (an include is read before it, so MUI_HEADER_TEXT would not exist yet).
!macro customPageAfterChangeDir
  Page custom ModelPageCreate ModelPageLeave

  Function ModelPageCreate
    !insertmacro MUI_HEADER_TEXT "Local model" "Deus Neuma thinks with a model that runs on this PC."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 72u "Deus Neuma needs a model server and a model on this PC. If none is installed, setup can install Ollama (kept inside Deus Neuma's own folder, no admin rights) and download the model that fits this PC's graphics card or memory.$\r$\n$\r$\nThe download is about 4 to 35 GB, depending on the PC, and it can take a while. An Ollama or LM Studio you already have is used if it is new enough.$\r$\n$\r$\nYou can also leave this for later: Deus Neuma offers it again when it first starts."
    Pop $0
    ${NSD_CreateCheckbox} 0 84u 100% 12u "Set up the local model server and the model for this PC (recommended)"
    Pop $ModelCheckbox
    ${NSD_Check} $ModelCheckbox
    nsDialogs::Show
  FunctionEnd

  Function ModelPageLeave
    ${NSD_GetState} $ModelCheckbox $SetupModel
  FunctionEnd
!macroend

!macro customInstall
  ${If} $SetupModel == ${BST_CHECKED}
    DetailPrint "Setting up the local model server and the model for this PC. This can take a while."
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'
    nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\app\backend\cli\setup-model-server.mjs" --yes'
    Pop $0
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")i'
    ${If} $0 == 0
      DetailPrint "The local model server and the model are ready."
    ${Else}
      DetailPrint "The local model server could not be set up now. Deus Neuma will offer it again when it first starts."
    ${EndIf}
  ${EndIf}
!macroend
!endif
