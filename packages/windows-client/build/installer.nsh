!macro customInit
  ${If} $hasPerUserInstallation == "0"
  ${AndIf} $hasPerMachineInstallation == "0"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\staix"
  ${EndIf}
!macroend
