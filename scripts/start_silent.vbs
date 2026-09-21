Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = "c:\project\tingxie"
ws.Run "cmd /c node server/src/index.js >> c:\project\tingxie\tingxie.log 2>&1", 0, False
