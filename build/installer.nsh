; installer.nsh - the Deus Neuma setup wizard for Windows (electron-builder includes build/installer.nsh).
;
; THE INSTALL STANDARD (2026-10-22), for every Windows installer Ignis ships: ONE setup .exe, built and
; signed by us, that a person double-clicks. A classic wizard, start to finish: the person sees every
; step, chooses every location and every option, and nothing is ever asked of them in a terminal. The
; installer, not the person, checks the PC and provides what the app needs. The pages, in order:
;   Welcome
;   What it needs + License (build/installer-license.txt: the requirements, then the EULA, 18+)
;   Install for: just me / everyone on this PC        (electron-builder)
;   Install location, with Browse: ...\Programs\Deus Neuma by default
;   System check: Windows, memory, graphics card, disk, a model server already here, the internet;
;                 each line says what was found and what setup will do about it (installer-preflight.ps1)
;   Components: Deus Neuma (required), the local model server and the model for this PC, the benchmarks
;               kit, a Start menu entry, a desktop shortcut, start Deus Neuma with Windows
;   Model location, with Browse (only when the model is chosen): models can be 30+ GB
;   Ready to install: everything chosen, before anything is written
;   Installing, with every step shown; the model step runs the app's own runtime (NEUMA.exe as
;     Node) with backend/cli/setup-model-server.mjs --home <the chosen folder>, the same code the
;     app's first run uses. If it cannot finish, the install still succeeds and the app offers it.
;   Finish, with Launch Deus Neuma (checked)
; Every choice is kept (HKCU\Software\Deus Neuma), so an update (electron-updater, --updated) shows no
; page, installs no component again and keeps them. The uninstaller removes the shortcuts and the
; start-with-Windows entry, and asks before it removes the model folder (kept by default), which it
; touches only while it carries the mark setup wrote into it (DnModelHomeVerdict).

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!include "TextFunc.nsh"
!include "WinVer.nsh"

!define DN_REG "Software\Deus Neuma"
!define DN_RUN "Software\Microsoft\Windows\CurrentVersion\Run"
; Written into the model folder by setup (customInstall); the uninstaller touches only a folder that has it.
!define DN_MODEL_MARK ".deus-neuma-model-home"

; May the uninstaller stop the model server in, and delete, the model folder read back from HKCU? An
; all-users uninstall runs elevated, but HKCU stays writable by anything the person runs, so the value
; alone proves nothing. The folder must carry the mark setup wrote into it, must be a full path, and
; must not be a drive root, nor be or hold Windows, Program Files, the profile or the install folder
; (so never the install folder's parent), nor lie inside Windows. Sets VERDICT to "" when it may, else
; to why not. Uses $R0-$R2.
!macro DnCovers TARGET VERDICT
  ${If} ${VERDICT} == ""
    StrLen $R2 "$R0\"
    StrCpy $R1 "${TARGET}\" $R2
    ${If} $R1 == "$R0\"
      StrCpy ${VERDICT} "it is, or holds, ${TARGET}"
    ${EndIf}
  ${EndIf}
!macroend
!macro DnModelHomeVerdict HOME VERDICT
  StrCpy ${VERDICT} ""
  StrCpy $R0 "${HOME}"
  StrCpy $R1 $R0 1 -1
  ${If} $R1 == "\"
    StrCpy $R0 $R0 -1
  ${EndIf}
  StrCpy $R1 $R0 1 1
  StrLen $R2 $R0
  ${If} $R1 != ":"
    StrCpy ${VERDICT} "it is not a full path on a drive"
  ${ElseIf} $R2 <= 2
    StrCpy ${VERDICT} "it is a whole drive"
  ${ElseIfNot} ${FileExists} "$R0\${DN_MODEL_MARK}"
    StrCpy ${VERDICT} "setup's mark is not in it"
  ${EndIf}
  !insertmacro DnCovers "$WINDIR" ${VERDICT}
  !insertmacro DnCovers "$PROGRAMFILES" ${VERDICT}
  !insertmacro DnCovers "$PROGRAMFILES64" ${VERDICT}
  !insertmacro DnCovers "$PROFILE" ${VERDICT}
  !insertmacro DnCovers "$INSTDIR" ${VERDICT}
  ${If} ${VERDICT} == ""
    StrLen $R2 "$WINDIR\"
    StrCpy $R1 "$R0" $R2
    ${If} $R1 == "$WINDIR\"
      StrCpy ${VERDICT} "it is inside Windows"
    ${EndIf}
  ${EndIf}
!macroend

; The folder the person sees is the trademark: ...\Programs\Deus Neuma, not the internal product name
; (NEUMA names the app's data folder and keychain entry, electron-builder.yml). This file is read before
; electron-builder's own script, so every default location, and the "add the app's folder to a folder
; the person browsed to" rule, use it. Nothing reads an install from this name: an installed copy is
; found by its registry entry.
!ifdef APP_FILENAME
  !undef APP_FILENAME
!endif
!define APP_FILENAME "Deus Neuma"

!ifndef BUILD_UNINSTALLER
  ; the Finish page (electron-builder inserts it, with its own launch-as-the-person function)
  !define MUI_FINISHPAGE_TITLE "Deus Neuma is installed"
  !define MUI_FINISHPAGE_TEXT "Deus Neuma ${VERSION} is installed on this PC.$\r$\n$\r$\nWhat happens next: Deus Neuma opens and walks you through the first steps. The first time it opens, the model loads into your PC's memory, which can take a minute. After that it is quick. If you ever want it gone, Settings > Apps removes everything.$\r$\n$\r$\nDeus Neuma is for adults only (18+).$\r$\n$\r$\nClick Finish to close this wizard."
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Deus Neuma"
  ; the install log stays on screen, "Completed", until the person clicks Next
  !define MUI_FINISHPAGE_NOAUTOCLOSE
!endif

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

; The details list is the person's log of the install: electron-builder turns it off for its own steps
; (SetDetailsPrint none), so it is turned back on here, at the first hook inside the install section, and
; every step says what it is doing before it does it. electron-builder's own running-app check follows.
; (defining this hook makes electron-builder skip what its own check needs, so it is included here:
; IS_POWERSHELL_AVAILABLE declares $IsPowerShellAvailable, which _CHECK_APP_RUNNING reads; without it
; makensis stops the uninstaller build on warning 6000, an unknown variable)
!include "getProcessInfo.nsh"
Var pid
!macro customCheckAppRunning
  SetDetailsPrint both
  !ifdef BUILD_UNINSTALLER
    DetailPrint "Removing Deus Neuma ${VERSION} from $INSTDIR."
  !else
    DetailPrint "Installing Deus Neuma ${VERSION} to $INSTDIR."
    DetailPrint "Closing Deus Neuma first, if it is running."
  !endif
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    DetailPrint "Copying Deus Neuma's files: about 1 GB, a minute or two."
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
Var CompModel
Var CompBench
Var CompStartMenu
Var CompDesktop
Var CompStartup
Var ModelHome
Var CbModel
Var CbStartMenu
Var CbDesktop
Var CbStartup
Var ModelHomeField
Var PfDone
Var PfOS
Var PfRam
Var PfGpu
Var PfGpuGB
Var PfDriver
Var PfDriverFloor
Var PfDriverOld
Var PfVc
Var PfOllama
Var PfOllamaRunning
Var PfLmStudio
Var PfOnline
Var PfDiskGB
Var PfBold
!endif

; Before any page: 64-bit Windows 10 or 11 only, said before anything is copied. Then the defaults every
; page starts from (also what a silent install, /S, installs).
!macro customInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Deus Neuma needs 64-bit Windows 10 or 11. This Windows is 32-bit, so it cannot be installed here."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Deus Neuma needs 64-bit Windows 10 or 11. This PC runs an older Windows, so it cannot be installed here."
    Abort
  ${EndIf}
  StrCpy $CompModel ${BST_CHECKED}
  StrCpy $CompBench ${BST_UNCHECKED}
  StrCpy $CompStartMenu ${BST_CHECKED}
  StrCpy $CompDesktop ${BST_CHECKED}
  StrCpy $CompStartup ${BST_UNCHECKED}
  ReadRegStr $ModelHome HKCU "${DN_REG}" "ModelHome"
  ${If} $ModelHome == ""
    StrCpy $ModelHome "$PROFILE\.neuma\data\model-server"
  ${EndIf}
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Deus Neuma ${VERSION} Setup"
  !define MUI_WELCOMEPAGE_TEXT "This wizard installs Deus Neuma: sovereign relationships with AI, on your own PC.$\r$\n$\r$\nSetup checks this PC first and shows you what it found. You choose where Deus Neuma goes and what comes with it. If this PC has no local model server, setup installs one, and the model that fits this PC.$\r$\n$\r$\nDeus Neuma is for adults only (18+).$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!ifndef BUILD_UNINSTALLER
; one System check row: a bold name, then what was found
!macro DnRow y name finding
  ${NSD_CreateLabel} 0 ${y} 72u 18u "${name}"
  Pop $R9
  SendMessage $R9 ${WM_SETFONT} $PfBold 0
  ${NSD_CreateLabel} 76u ${y} -76u 18u "${finding}"
  Pop $R9
!macroend
!define DnRow '!insertmacro DnRow'

; The pages and their functions live where electron-builder inserts them: by then the Modern UI is
; loaded (an include is read before it, so MUI_HEADER_TEXT would not exist yet).
!macro customPageAfterChangeDir
  Page custom SystemCheckCreate SystemCheckLeave
  Page custom ComponentsCreate ComponentsLeave
  Page custom ModelHomeCreate ModelHomeLeave
  Page custom ReadyCreate

  ; the folder the app will really go to: electron-builder adds "\Deus Neuma" to a folder that lacks it
  Function DnInstallDir
    ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
    ${If} $0 == ""
      Push "$INSTDIR\${APP_FILENAME}"
    ${Else}
      Push "$INSTDIR"
    ${EndIf}
  FunctionEnd

  Function SystemCheckCreate
    !insertmacro MUI_HEADER_TEXT "System check" "Setup checked this PC. Nothing has been installed yet."
    ; read the PC once: hidden, read-only (build/installer-preflight.ps1), the 64-bit PowerShell
    ${If} $PfDone != 1
      InitPluginsDir
      File "/oname=$PLUGINSDIR\preflight.ps1" "${BUILD_RESOURCES_DIR}\installer-preflight.ps1"
      ${DisableX64FSRedirection}
      nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\preflight.ps1" "$PLUGINSDIR\preflight.txt"'
      ${EnableX64FSRedirection}
      Pop $0
      Pop $0
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "os=" $PfOS
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "ramGB=" $PfRam
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "gpu=" $PfGpu
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "gpuGB=" $PfGpuGB
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "gpuDriver=" $PfDriver
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "driverFloor=" $PfDriverFloor
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "driverOld=" $PfDriverOld
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "vcRuntime=" $PfVc
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "ollama=" $PfOllama
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "ollamaRunning=" $PfOllamaRunning
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "lmstudio=" $PfLmStudio
      ${ConfigRead} "$PLUGINSDIR\preflight.txt" "online=" $PfOnline
      ${If} $PfRam == ""
        StrCpy $PfRam 0
      ${EndIf}
      ${If} $PfGpuGB == ""
        StrCpy $PfGpuGB 0
      ${EndIf}
      StrCpy $PfDone 1
    ${EndIf}
    ; the install folder's drive is read every time: Back can change the folder
    StrCpy $1 $INSTDIR 3
    ${DriveSpace} "$1" "/D=F /S=G" $PfDiskGB

    nsDialogs::Create 1018
    Pop $0
    CreateFont $PfBold "$(^Font)" "$(^FontSize)" "700"

    ${If} $PfOS == ""
      StrCpy $PfOS "64-bit Windows 10 or 11"
    ${EndIf}
    ${DnRow} 0u "Windows" "$PfOS: ready."

    ${If} $PfRam >= 16
      StrCpy $3 "$PfRam GB: ready."
    ${ElseIf} $PfGpuGB >= 8
      StrCpy $3 "$PfRam GB: enough with this graphics card."
    ${ElseIf} $PfRam == 0
      StrCpy $3 "Could not be read. Setup carries on."
    ${Else}
      StrCpy $3 "$PfRam GB: below the 16 GB a model on the processor needs. It may run slowly."
    ${EndIf}
    ${DnRow} 19u "Memory" "$3"

    ${If} $PfGpuGB >= 8
      StrCpy $3 "$PfGpu, $PfGpuGB GB: ready. Setup picks the model that fits it."
    ${ElseIf} $PfGpu != ""
      StrCpy $3 "$PfGpu, $PfGpuGB GB: below 8 GB, so a smaller model runs on the processor."
    ${Else}
      StrCpy $3 "None with its own memory found. A smaller model runs on the processor."
    ${EndIf}
    ; an NVIDIA driver below its card's floor: the app keeps the model off the card until it is updated
    ${If} $PfDriverOld == 1
      StrCpy $3 "$PfGpu: driver $PfDriver is older than the $PfDriverFloor it needs. The model stays off the card until you update it."
    ${EndIf}
    ${DnRow} 38u "Graphics card" "$3"

    ${If} $PfDiskGB >= 40
      StrCpy $3 "$1 has $PfDiskGB GB free: ready."
    ${ElseIf} $PfDiskGB >= 5
      StrCpy $3 "$1 has $PfDiskGB GB free: enough for the app. You can keep the model on another drive."
    ${Else}
      StrCpy $3 "$1 has $PfDiskGB GB free: the app needs about 5 GB. Click Back to choose another drive."
    ${EndIf}
    ${DnRow} 57u "Disk" "$3"

    ${If} $PfOllama != ""
      StrCpy $3 "Ollama $PfOllama is installed. Setup uses it if it is new enough, or installs its own."
    ${ElseIf} $PfOllamaRunning == 1
      StrCpy $3 "Ollama is running. Setup uses it if it is new enough, or installs its own."
    ${ElseIf} $PfLmStudio == 1
      StrCpy $3 "LM Studio is installed. Setup can still install Ollama and the model (next page)."
    ${Else}
      StrCpy $3 "None yet. Setup installs Ollama and the model for you (next page)."
    ${EndIf}
    ; the server setup installs loads the Visual C++ runtime; one already here brings its own
    ${If} $PfVc == 0
    ${AndIf} $PfOllama == ""
    ${AndIf} $PfOllamaRunning != 1
      StrCpy $3 "Needs the Visual C++ runtime (missing). Get it: aka.ms/vs/17/release/vc_redist.x64.exe, then reinstall."
    ${EndIf}
    ${DnRow} 76u "Model server" "$3"

    ${If} $PfOnline == 1
      StrCpy $3 "Connected: ready for the model download."
    ${Else}
      StrCpy $3 "Not connected now. Setup still tries the model; if it cannot, Deus Neuma offers it later."
    ${EndIf}
    ${DnRow} 95u "Internet" "$3"

    ${If} $PfDiskGB < 5
      StrCpy $3 "This drive is too full for Deus Neuma. Click Back and choose a folder on another drive."
    ${ElseIf} $PfDriverOld == 1
      StrCpy $3 "Update the graphics driver from NVIDIA (nvidia.com/drivers). Until then the model runs on the processor, slower. Click Next to choose what to install."
    ${ElseIf} $PfGpuGB < 8
    ${AndIf} $PfRam < 16
    ${AndIf} $PfRam > 0
      StrCpy $3 "This PC is below what a local model needs to run well. You can still install Deus Neuma. Click Next to choose what to install."
    ${Else}
      StrCpy $3 "Everything Deus Neuma needs is here, or setup installs it. Click Next to choose what to install."
    ${EndIf}
    ${NSD_CreateLabel} 0 118u 100% 20u "$3"
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function SystemCheckLeave
    ${If} $PfDiskGB < 1
      MessageBox MB_OK|MB_ICONEXCLAMATION "The drive $INSTDIR is on is full. Click Back and choose a folder on another drive."
      Abort
    ${EndIf}
  FunctionEnd

  Function ComponentsCreate
    !insertmacro MUI_HEADER_TEXT "Components" "Choose what to install with Deus Neuma."
    ; The model is always offered checked: a person who knows nothing still ends up with one. Even
    ; offline (or when the System check could not run) setup tries; if it cannot, the app offers it.
    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateCheckbox} 0 0 100% 12u "Deus Neuma ${VERSION} (required)"
    Pop $0
    ${NSD_Check} $0
    EnableWindow $0 0

    ${NSD_CreateCheckbox} 0 16u 100% 12u "Local model server and the model for this PC (recommended)"
    Pop $CbModel
    ${NSD_SetState} $CbModel $CompModel
    ${NSD_CreateLabel} 12u 29u -12u 28u "The AI Deus Neuma thinks with. It runs on your PC, so your conversations stay private. Setup downloads Ollama (what runs it), the model that fits this PC (3 to 35 GB), and Microsoft's runtime if missing."
    Pop $0

    ${NSD_CreateCheckbox} 0 60u 100% 12u "Benchmarks kit (coming in a later update)"
    Pop $0
    EnableWindow $0 0

    ${NSD_CreateCheckbox} 0 78u 100% 12u "Start menu entry"
    Pop $CbStartMenu
    ${NSD_SetState} $CbStartMenu $CompStartMenu

    ${NSD_CreateCheckbox} 0 94u 100% 12u "Desktop shortcut"
    Pop $CbDesktop
    ${NSD_SetState} $CbDesktop $CompDesktop

    ${NSD_CreateCheckbox} 0 110u 100% 12u "Start Deus Neuma when Windows starts"
    Pop $CbStartup
    ${NSD_SetState} $CbStartup $CompStartup
    ${NSD_CreateLabel} 12u 123u -12u 12u "You can change this later in Deus Neuma's settings."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function ComponentsLeave
    ${NSD_GetState} $CbModel $CompModel
    ${NSD_GetState} $CbStartMenu $CompStartMenu
    ${NSD_GetState} $CbDesktop $CompDesktop
    ${NSD_GetState} $CbStartup $CompStartup
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
    Call DnInstallDir
    Pop $2
    StrCpy $1 "Install location:$\r$\n      $2$\r$\n$\r$\nComponents:$\r$\n      Deus Neuma ${VERSION}"
    ${If} $CompModel == ${BST_CHECKED}
      StrCpy $1 "$1$\r$\n      Local model server and the model for this PC$\r$\n            kept in $ModelHome"
    ${EndIf}
    ${If} $CompStartMenu == ${BST_CHECKED}
      StrCpy $1 "$1$\r$\n      Start menu entry"
    ${EndIf}
    ${If} $CompDesktop == ${BST_CHECKED}
      StrCpy $1 "$1$\r$\n      Desktop shortcut"
    ${EndIf}
    ${If} $CompStartup == ${BST_CHECKED}
      StrCpy $1 "$1$\r$\n      Starts when Windows starts"
    ${EndIf}
    StrCpy $1 "$1$\r$\n$\r$\nClick Install to begin, or Back to change anything."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 100% "$1"
    Pop $0
    nsDialogs::Show
  FunctionEnd
!macroend

; electron-builder has copied the app and made the Start menu entry ($newStartMenuLink, named with the
; app's notification ID) by now.
!macro customInstall
  SetDetailsPrint both
  DetailPrint "Deus Neuma's files are in place."
  DetailPrint "Registered with Windows: Settings > Apps lists Deus Neuma ${VERSION}."
  ${If} ${isUpdated}
    ; an update keeps the person's choices: the Start menu entry the update remade goes again if they
    ; had chosen none
    ReadRegStr $0 HKCU "${DN_REG}" "StartMenu"
    ${If} $0 == "0"
      WinShell::UninstShortcut "$newStartMenuLink"
      Delete "$newStartMenuLink"
      StrCpy $launchLink "$appExe"
    ${EndIf}
  ${Else}
    ${If} $CompStartMenu == ${BST_CHECKED}
      WriteRegStr HKCU "${DN_REG}" "StartMenu" "1"
      DetailPrint "Start menu entry created."
    ${Else}
      WinShell::UninstShortcut "$newStartMenuLink"
      Delete "$newStartMenuLink"
      StrCpy $launchLink "$appExe"
      WriteRegStr HKCU "${DN_REG}" "StartMenu" "0"
      DetailPrint "No Start menu entry, as chosen."
    ${EndIf}
    ${If} $CompDesktop == ${BST_CHECKED}
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
      DetailPrint "Desktop shortcut created."
    ${EndIf}
    ; the same Run entry the app's own "open at login" setting reads and writes (Electron, named with
    ; the app's ID, electron/main.cjs), so the box here and the setting in the app are one switch
    ${If} $CompStartup == ${BST_CHECKED}
      WriteRegStr HKCU "${DN_RUN}" "${APP_ID}" '"$appExe"'
      DetailPrint "Deus Neuma will start when Windows starts."
    ${Else}
      DeleteRegValue HKCU "${DN_RUN}" "${APP_ID}"
    ${EndIf}
    ${If} $CompModel != ${BST_CHECKED}
      DetailPrint "Local model server: not chosen. Deus Neuma offers it when it first starts."
    ${EndIf}
    ${If} $CompModel == ${BST_CHECKED}
      WriteRegStr HKCU "${DN_REG}" "ModelHome" "$ModelHome"
      ; the mark the uninstaller looks for before it stops or removes anything in this folder
      CreateDirectory "$ModelHome"
      FileOpen $1 "$ModelHome\${DN_MODEL_MARK}" w
      FileWrite $1 "Deus Neuma setup made this folder its model folder. The uninstaller removes it only while this file is here.$\r$\n"
      FileClose $1
      DetailPrint "What is happening: Deus Neuma thinks with an AI model that runs on YOUR PC, so your conversations stay with you."
      DetailPrint "A model server (Ollama) runs the model, and the model itself is a large file. Both go in $ModelHome."
      ${If} $PfVc == 0
        InitPluginsDir
        File "/oname=$PLUGINSDIR\runtime.ps1" "${BUILD_RESOURCES_DIR}\installer-runtime.ps1"
        ${DisableX64FSRedirection}
        nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\runtime.ps1"'
        ${EnableX64FSRedirection}
        Pop $0
      ${EndIf}
      DetailPrint "Only downloads happen now. Nothing is loaded onto your graphics card until Deus Neuma first opens."
      DetailPrint "This downloads several GB and can take a while. Every step is shown below."
      System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'
      nsExec::ExecToLog '"$appExe" "$INSTDIR\resources\app\backend\cli\setup-model-server.mjs" --yes --home "$ModelHome"'
      Pop $0
      System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")i'
      ${If} $0 == 0
        DetailPrint "The local model server and the model are downloaded. The model starts when Deus Neuma first opens."
      ${Else}
        DetailPrint "The local model server could not be set up now. Deus Neuma will offer it again when it first starts."
      ${EndIf}
    ${EndIf}
  ${EndIf}
  DetailPrint "Deus Neuma ${VERSION} is installed."
!macroend
!endif

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    DeleteRegValue HKCU "${DN_RUN}" "${APP_ID}"
    ReadRegStr $0 HKCU "${DN_REG}" "ModelHome"
    ${If} $0 != ""
      !insertmacro DnModelHomeVerdict "$0" $2
      ${If} $2 != ""
        DetailPrint "Left the model folder $0 as it is: $2."
        StrCpy $0 ""
      ${EndIf}
    ${EndIf}
    ${If} $0 != ""
      ; The model server the setup started lives in that folder. Stopped first, it cannot hold the folder's
      ; files open, nor go on running after Deus Neuma is gone. Matched by the folder (read from the
      ; environment, so no path is ever quoted into the command), never by name alone: the person's own
      ; Ollama elsewhere is left running. This is 32-bit code on 64-bit Windows: the 64-bit PowerShell and
      ; WMI are used because a 32-bit one cannot read the path of a 64-bit process.
      System::Call 'Kernel32::SetEnvironmentVariable(t "DN_MODEL_HOME", t "$0")i'
      ${DisableX64FSRedirection}
      nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "Get-CimInstance Win32_Process -Filter \"Name='ollama.exe'\" | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$env:DN_MODEL_HOME, 'OrdinalIgnoreCase') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
      ${EnableX64FSRedirection}
      Pop $1
      System::Call 'Kernel32::SetEnvironmentVariable(t "DN_MODEL_HOME", t "")i'
      ${If} ${FileExists} "$0\*.*"
        ; /SD IDNO: a silent uninstall keeps the models (a message box would otherwise wait for ever)
        ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove the local model server and the downloaded models in:$\r$\n$0$\r$\n$\r$\nThey can be large. Choose No to keep them for a later install." /SD IDNO IDYES`
          RMDir /r "$0"
          DetailPrint "Removed the model folder $0."
        ${EndIf}
      ${EndIf}
    ${EndIf}
    DeleteRegKey HKCU "${DN_REG}"
  ${EndIf}
!macroend
