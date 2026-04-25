param (
[string]$Output = "backup.zip"
)

$root = Get-Location

# Load .gitignore rules

$gitignorePath = Join-Path $root ".gitignore"
$ignorePatterns = @()

if (Test-Path $gitignorePath) {
$ignorePatterns = Get-Content $gitignorePath |
Where-Object { $_ -and -not $*.StartsWith("#") } |
ForEach-Object { $*.Trim() }
}

# Convert gitignore-style patterns to regex

function Convert-ToRegex($pattern) {
# Escape regex special chars first
$escaped = [regex]::Escape($pattern)

```
# Convert gitignore wildcards
$escaped = $escaped -replace "\\\*", ".*"

# Handle directory rules (ending with /)
if ($pattern.EndsWith("/")) {
    return "^$escaped"
}

return "^$escaped$"
```

}

$regexPatterns = $ignorePatterns | ForEach-Object { Convert-ToRegex $_ }

# Get all files recursively

$files = Get-ChildItem -Recurse -File

# Filter files

$includedFiles = $files | Where-Object {
$relativePath = $_.FullName.Substring($root.Path.Length + 1)

```
foreach ($regex in $regexPatterns) {
    if ($relativePath -match $regex) {
        return $false
    }
}

return $true
```

}

# Remove existing zip if exists

if (Test-Path $Output) {
Remove-Item $Output
}

# Create temp staging folder

$tempDir = Join-Path $env:TEMP ("backup_temp_" + (Get-Random))
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy included files preserving structure

foreach ($file in $includedFiles) {
$relativePath = $file.FullName.Substring($root.Path.Length + 1)
$destination = Join-Path $tempDir $relativePath
$destDir = Split-Path $destination

```
if (!(Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

Copy-Item $file.FullName -Destination $destination
```

}

# Zip it (FIXED PATH)

Compress-Archive -Path "$tempDir*" -DestinationPath $Output

# Cleanup

Remove-Item $tempDir -Recurse -Force

Write-Host "Backup created: $Output"
