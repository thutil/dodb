; Inno Setup script for dodb Database Manager
; Generated for Windows x64

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

#define MyAppName "dodb"
#define MyAppPublisher "thutil"
#define MyAppURL "https://dodb.thutil.com"
#define MyAppExeName "dodb.exe"

[Setup]
; App identity
AppId={{8B84B29E-86EE-47D5-B8A8-16E0A6CD19B8}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL=https://github.com/thutil/dodb/issues
AppUpdatesURL=https://github.com/thutil/dodb/releases

; Modern installation defaults
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
; Per-user install by default, but allows all-users override via installer dialog
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; Output settings
OutputDir=..\..\dist
OutputBaseFilename=dodb_{#MyAppVersion}_windows_x64_setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

; Compression
Compression=lzma2/ultra64
SolidCompression=yes

; Visuals & UX
WizardStyle=modern
WizardSizePercent=100
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Filename: "{app}\{#MyAppExeName}"; Flags: nowait postinstall skipifsilent
