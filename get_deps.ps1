# 依存ファイル（Leaflet/JSZip/toGeoJSON）
$ErrorActionPreference = "Stop"
function Get-File($Url, $OutPath) { Invoke-WebRequest -Uri $Url -OutFile $OutPath -UseBasicParsing }
Get-File "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" "leaflet.js"
Get-File "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" "leaflet.css"
Get-File "https://unpkg.com/@tmcw/togeojson@5.7.0/dist/togeojson.umd.js" "togeojson.umd.js"
Get-File "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js" "jszip.min.js"
