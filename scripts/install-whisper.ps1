# Installs local speech-to-text for Dayspring's "Tune in" and Discord features: whisper.cpp (CPU build, from the
# official GitHub releases of ggml-org/whisper.cpp) and an English model (from huggingface.co/ggerganov/whisper.cpp).
# Everything goes into bin\whisper next to Dayspring; nothing else on the computer changes. Run it again any time.
#   -Model base.en (default, ~148 MB, good) | tiny.en (~78 MB, fastest) | small.en (~488 MB, best, slower)
param([string]$Model = "base.en")
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = Join-Path $PSScriptRoot "..\bin\whisper"
$dir = [IO.Path]::GetFullPath($dir)
New-Item -ItemType Directory -Force -Path (Join-Path $dir "models") | Out-Null
$ua = @{ "User-Agent" = "Dayspring" }

# 1. whisper.cpp: the newest release that has the Windows x64 CPU build
$exe = Get-ChildItem $dir -Recurse -Filter whisper-server.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  Write-Output "Finding the latest whisper.cpp for Windows..."
  $rels = Invoke-RestMethod "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15" -Headers $ua
  $asset = $null; $tag = $null
  foreach ($r in $rels) { $a = $r.assets | Where-Object { $_.name -eq "whisper-bin-x64.zip" } | Select-Object -First 1; if ($a) { $asset = $a; $tag = $r.tag_name; break } }
  if (-not $asset) { throw "Couldn't find whisper-bin-x64.zip in the recent whisper.cpp releases." }
  $zip = Join-Path $env:TEMP "dayspring-whisper-$tag.zip"
  Write-Output "Downloading whisper.cpp $tag ($([math]::Round($asset.size / 1MB, 1)) MB)..."
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip -Headers $ua -UseBasicParsing
  Expand-Archive $zip -DestinationPath (Join-Path $dir "app") -Force
  Remove-Item $zip -Force
  Set-Content (Join-Path $dir "VERSION.txt") $tag -Encoding ascii
  $exe = Get-ChildItem $dir -Recurse -Filter whisper-server.exe | Select-Object -First 1
  if (-not $exe) { throw "The download didn't contain whisper-server.exe." }
}
Write-Output "whisper.cpp: $($exe.FullName)"

# 2. the model
$file = "ggml-$Model.bin"
$dest = Join-Path $dir "models\$file"
if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 10MB) {
  Write-Output "Downloading the $Model speech model..."
  $tmp = "$dest.part"
  Invoke-WebRequest "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$file" -OutFile $tmp -Headers $ua -UseBasicParsing
  if ((Get-Item $tmp).Length -lt 10MB) { Remove-Item $tmp -Force; throw "The model download was incomplete." }
  Move-Item $tmp $dest -Force
}
Write-Output ("Model: {0} ({1} MB)" -f $file, [math]::Round((Get-Item $dest).Length / 1MB))
Write-Output "Speech-to-text is ready."
