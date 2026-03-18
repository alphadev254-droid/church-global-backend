# Replace nationalAdminId with ministryAdminId across the codebase
Write-Host "Starting replacement..." -ForegroundColor Green

$directories = @(
    "src\controllers",
    "src\lib",
    "src\middleware",
    "src\routes",
    "src\utils",
    "src\services"
)

$totalFiles = 0
$totalReplacements = 0

foreach ($dir in $directories) {
    $path = Join-Path $PSScriptRoot $dir
    
    if (Test-Path $path) {
        Write-Host "Searching in: $dir" -ForegroundColor Cyan
        
        $files = Get-ChildItem -Path $path -Filter "*.ts" -Recurse
        
        foreach ($file in $files) {
            $content = Get-Content $file.FullName -Raw
            $originalContent = $content
            
            $content = $content -replace 'nationalAdminId', 'ministryAdminId'
            $content = $content -replace 'NationalAdminChurches', 'MinistryAdminChurches'
            $content = $content -replace 'nationalAdmin(?=\s*[:\.])', 'ministryAdmin'
            
            if ($content -ne $originalContent) {
                Set-Content -Path $file.FullName -Value $content -NoNewline
                $replacements = ([regex]::Matches($originalContent, 'nationalAdminId')).Count
                $totalReplacements += $replacements
                $totalFiles++
                Write-Host "  Updated: $($file.Name)" -ForegroundColor Yellow
            }
        }
    }
}

Write-Host "Complete! Files updated: $totalFiles, Total replacements: $totalReplacements" -ForegroundColor Green
