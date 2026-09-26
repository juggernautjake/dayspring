' Starts Dayspring with no command window at all (the Dayspring shortcuts on the desktop and in the Start menu run this).
' It does the same as "Start Dayspring.cmd": starts Dayspring if it isn't running, then opens its screen, or the guided
' setup the first time. Dayspring never opens twice: if it's already open, its window comes back.
' Arguments are passed on to scripts\launch.mjs: the "Dayspring (full screen)" and "Dayspring in browser" shortcuts add
' --open-as fullscreen or --open-as tab.
Option Explicit
Dim sh, fso, here, extra, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "Dayspring needs Node.js, and it isn't installed yet." & vbCrLf & vbCrLf & "Open the Dayspring folder and double-click ""Install Dayspring.cmd"".", 48, "Dayspring"
  WScript.Quit 1
End If
If Not fso.FolderExists(here & "\node_modules") Then
  ' first run after unzipping: the parts still need downloading, so show that window this once
  sh.Run "cmd /c """ & here & "\Start Dayspring.cmd""", 1, False
  WScript.Quit 0
End If
extra = ""
For i = 0 To WScript.Arguments.Count - 1
  extra = extra & " """ & WScript.Arguments(i) & """"
Next
sh.Run "node """ & here & "\scripts\launch.mjs""" & extra, 0, False
