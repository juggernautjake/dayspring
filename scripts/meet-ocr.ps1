# Reads the words in a picture of the meeting window with Windows' own text recognition (built in and offline: nothing
# leaves the computer). Used only when the meeting page itself can't be read, to find the name labels on the video
# tiles (lib/meet/ocr.mjs). The picture is a temporary file the caller deletes straight after.
# Prints JSON: { ok, lang, width, height, lines: [{ text, x, y, w, h }] }  or  { ok: false, error }.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$task.Wait(15000); $task.Result }
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) { @{ ok = $false; error = "no-ocr-language" } | ConvertTo-Json -Compress; exit 0 }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines = @(foreach ($l in $result.Lines) {
      $r = @($l.Words | ForEach-Object { $_.BoundingRect })
      $x = ($r | ForEach-Object { $_.X } | Measure-Object -Minimum).Minimum
      $y = ($r | ForEach-Object { $_.Y } | Measure-Object -Minimum).Minimum
      $x2 = ($r | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
      $y2 = ($r | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
      @{ text = ($l.Text -replace '[\x00-\x1F]', ' '); x = [int]$x; y = [int]$y; w = [int]($x2 - $x); h = [int]($y2 - $y) }
    })
    @{ ok = $true; lang = $engine.RecognizerLanguage.LanguageTag; width = $bitmap.PixelWidth; height = $bitmap.PixelHeight; lines = $lines } | ConvertTo-Json -Compress -Depth 4
  } finally { $stream.Dispose() }
} catch { @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }
