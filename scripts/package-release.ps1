$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'release'

Push-Location $projectRoot
try {
  npm.cmd run build
  node scripts/build-release.mjs

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archives = @()
  Get-ChildItem -LiteralPath $releaseRoot -Directory | ForEach-Object {
    $archive = Join-Path $releaseRoot ($_.Name + '.zip')
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    $archiveStream = [System.IO.File]::Open($archive, [System.IO.FileMode]::CreateNew)
    $zip = New-Object System.IO.Compression.ZipArchive($archiveStream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
      $sourceRoot = $_.FullName.TrimEnd('\')
      Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | ForEach-Object {
        $entryName = $_.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
          $zip,
          $_.FullName,
          $entryName,
          [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
      }
    }
    finally {
      $zip.Dispose()
      $archiveStream.Dispose()
    }
    $archives += Get-Item -LiteralPath $archive
  }

  $checksumLines = $archives | Sort-Object Name | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($_.Name)"
  }
  Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Value $checksumLines -Encoding UTF8

  $archives | Select-Object Name, @{Name='MB'; Expression={[math]::Round($_.Length / 1MB, 2)}} | Format-Table -AutoSize
  Write-Output "Release assets are ready in $releaseRoot"
}
finally {
  Pop-Location
}
