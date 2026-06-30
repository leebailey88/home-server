param(
  [string]$SftpHost = "REPLACE_WITH_CBP_SFTP_HOST",
  [int]$SftpPort = 2222,
  [string]$SftpUser = "cbp-evabank-upload",
  [string]$RemotePath = "/incoming/evabank",
  [string]$LocalDir = "C:\Dashboard",
  [string]$KeyFile = "C:\Dashboard\cbp-evabank-upload.key",
  [string]$LogFile = "C:\Dashboard\CBP-Upload.log"
)

$ErrorActionPreference = "Stop"

function Write-Log {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
  Add-Content -Path $LogFile -Value "$timestamp $Message"
}

$files = @("GL DASH", "CD DASH", "LN DASH")

try {
  Write-Log "Starting Community Bank Pilot parallel upload."

  foreach ($file in $files) {
    $path = Join-Path $LocalDir $file
    if (-not (Test-Path -LiteralPath $path)) {
      throw "Required file not found: $path"
    }
  }

  $sftpBatch = New-TemporaryFile
  try {
    foreach ($file in $files) {
      $localPath = Join-Path $LocalDir $file
      Add-Content -Path $sftpBatch -Value "put `"$localPath`" `"$RemotePath/$file`""
    }

    $sftpArgs = @(
      "-b", $sftpBatch.FullName,
      "-i", $KeyFile,
      "-P", $SftpPort,
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes",
      "$SftpUser@$SftpHost"
    )

    & sftp @sftpArgs 2>&1 | ForEach-Object { Write-Log $_ }

    if ($LASTEXITCODE -ne 0) {
      throw "sftp exited with code $LASTEXITCODE"
    }
  }
  finally {
    if ($sftpBatch -and (Test-Path -LiteralPath $sftpBatch.FullName)) {
      Remove-Item -LiteralPath $sftpBatch.FullName -Force
    }
  }

  Write-Log "Completed Community Bank Pilot parallel upload."
  exit 0
}
catch {
  Write-Log "ERROR: $($_.Exception.Message)"

  # Do not break the existing Banker's Dashboard job if the pilot upload fails.
  exit 0
}
