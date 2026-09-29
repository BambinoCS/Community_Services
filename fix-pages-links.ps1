# fix-pages-links.ps1
# Run this from the root of your Community_Services repository.

$ErrorActionPreference = "Stop"
$root = (Get-Location).Path

function Rename-Safely {
    param(
        [string]$From,
        [string]$To
    )

    $src = Join-Path $root $From
    $dst = Join-Path $root $To

    if (Test-Path $dst) {
        Write-Host "SKIP: destination already exists: $To" -ForegroundColor Yellow
        return
    }

    if (Test-Path $src) {
        Rename-Item -LiteralPath $src -NewName (Split-Path $To -Leaf)
        Write-Host "RENAMED: $From -> $To" -ForegroundColor Green
    } else {
        Write-Host "SKIP: source not found: $From" -ForegroundColor Yellow
    }
}

function Copy-Safely {
    param(
        [string]$From,
        [string]$To
    )

    $src = Join-Path $root $From
    $dst = Join-Path $root $To

    if (Test-Path $dst) {
        Write-Host "SKIP: destination already exists: $To" -ForegroundColor Yellow
        return
    }

    if (Test-Path $src) {
        Copy-Item -LiteralPath $src -Destination $dst
        Write-Host "COPIED: $From -> $To" -ForegroundColor Green
    } else {
        Write-Host "SKIP: source not found: $From" -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# 1. Fix filename mismatches that may still exist in older checkouts
# ---------------------------------------------------------------------------

Rename-Safely "admin/frontend/admin_verify_assistants.html" `
              "admin/frontend/admin_verify-assistants.html"

Rename-Safely "community-user/frontend/commubity_user_requests.html" `
              "community-user/frontend/community-user_requests.html"

Rename-Safely "community-user/frontend/community_user_browse_requests.html" `
              "community-user/frontend/community-user_browse-requests.html"

Rename-Safely "verified-assistant/frontend/verified_assistant_active_jobs.html" `
              "verified-assistant/frontend/verified-assistant_active-jobs.html"

Rename-Safely "verified-assistant/frontend/verified_assistant_availible_requests.html" `
              "verified-assistant/frontend/verified-assistant_available-requests.html"

Rename-Safely "verified-assistant/frontend/verified_assistant_dashboard.html" `
              "verified-assistant/frontend/verified-assistant_dashboard.html"

Rename-Safely "verified-assistant/frontend/verified_assistant_profile.html" `
              "verified-assistant/frontend/verified-assistant_profile.html"

Rename-Safely "verified-assistant/frontend/verified_assistants_complefed_jobs.html" `
              "verified-assistant/frontend/verified-assistant_completed-jobs.html"

Rename-Safely "verified-assistant/frontend/verigied_assistant_training.html" `
              "verified-assistant/frontend/verified-assistant_training.html"

# ---------------------------------------------------------------------------
# 1b. Update every reference to the files we just renamed
#     (nav links in sibling pages + the redirect table in auth-policy.js)
# ---------------------------------------------------------------------------

$renameMap = @{
    "admin_verify_assistants.html"              = "admin_verify-assistants.html"
    "commubity_user_requests.html"               = "community-user_requests.html"
    "community_user_browse_requests.html"        = "community-user_browse-requests.html"
    "verified-assistant_active-jobs.html"        = "verified-assistant_active-jobs.html"
    "verified_assistant_availible_requests.html" = "verified-assistant_available-requests.html"
    "verified-assistant_dashboard.html"          = "verified-assistant_dashboard.html"
    "verified-assistant_profile.html"            = "verified-assistant_profile.html"
    "verified_assistants_complefed_jobs.html"    = "verified-assistant_completed-jobs.html"
    "verigied_assistant_training.html"           = "verified-assistant_training.html"
}

Write-Host ""
Write-Host "Updating cross-references to renamed files..." -ForegroundColor Cyan

Get-ChildItem -Path $root -Recurse -File | Where-Object { $_.Extension -in ".html", ".js" } | ForEach-Object {
    $file = $_.FullName
    $text = [System.IO.File]::ReadAllText($file)
    $original = $text
    foreach ($old in $renameMap.Keys) {
        $text = $text.Replace($old, $renameMap[$old])
    }
    if ($text -ne $original) {
        [System.IO.File]::WriteAllText($file, $text)
        Write-Host "UPDATED REFS: $($file.Substring($root.Length + 1))" -ForegroundColor Green
    }
}


# You already did this rename locally, so the script safely skips it if done.
Rename-Safely "shared/frontend/UI.js" "shared/frontend/ui.js"

Rename-Safely "shared/frontend/validation" "shared/frontend/validation.js"

Rename-Safely "verified-assistant/frontend/verified_assistant_active_jobs.js" `
              "verified-assistant/frontend/verified-assistant_active-jobs.js"

Rename-Safely "verified-assistant/frontend/verified_assistant_completed_jobs.js" `
              "verified-assistant/frontend/verified-assistant_completed-jobs.js"

Rename-Safely "verified-assistant/frontend/verified_assistant_profile.js" `
              "verified-assistant/frontend/verified-assistant_profile.js"

Rename-Safely "verified-assistant/frontend/verified_assistant_training.js" `
              "verified-assistant/frontend/verified-assistant_training.js"

# ---------------------------------------------------------------------------
# 2. Put browser JavaScript where the HTML expects it.
#    These files currently live in backend/ but contain browser-side DOM code.
#    We COPY them rather than delete the backend copies.
# ---------------------------------------------------------------------------

Copy-Safely "admin/backend/admin_dashboard.js" `
            "admin/frontend/admin_dashboard.js"

Copy-Safely "admin/backend/admin_donations.js" `
            "admin/frontend/admin_donations.js"

Copy-Safely "admin/backend/admin_reports.js" `
            "admin/frontend/admin_reports.js"

Copy-Safely "admin/backend/admin_requsts.js" `
            "admin/frontend/admin_requests.js"

Copy-Safely "admin/backend/admin_users.js" `
            "admin/frontend/admin_users.js"

Copy-Safely "admin/backend/admin_verify_assistants.js" `
            "admin/frontend/admin_verify-assistants.js"

Copy-Safely "community-user/backend/community_user_requests.js" `
            "community-user/frontend/community-user_requests.js"

Copy-Safely "community-user/backend/community_user_requesr_help.js" `
            "community-user/frontend/community-user_request-help.js"

Copy-Safely "community-user/backend/community_user_browse_requests.js" `
            "community-user/frontend/community-user_browse-requests.js"

# ---------------------------------------------------------------------------
# 3. Verify every relative HTML href/src points to a real file.
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "Checking HTML links..." -ForegroundColor Cyan

$missing = @()

Get-ChildItem -Path $root -Recurse -Filter *.html | ForEach-Object {
    $htmlFile = $_
    $html = Get-Content -LiteralPath $htmlFile.FullName -Raw
    if (-not $html) { return }

    [regex]::Matches($html, '(?i)(?:href|src)\s*=\s*["'']([^"'']+)["'']') |
        ForEach-Object {
            $ref = $_.Groups[1].Value

            if (
                $ref -and
                -not $ref.StartsWith("#") -and
                -not $ref.StartsWith("http://") -and
                -not $ref.StartsWith("https://") -and
                -not $ref.StartsWith("mailto:") -and
                -not $ref.StartsWith("javascript:") -and
                -not $ref.StartsWith("data:")
            ) {
                $target = Join-Path $htmlFile.DirectoryName $ref
                if (-not (Test-Path -LiteralPath $target)) {
                    $missing += [PSCustomObject]@{
                        File = $htmlFile.FullName.Substring($root.Length + 1)
                        Reference = $ref
                    }
                }
            }
        }
}

if ($missing.Count -eq 0) {
    Write-Host "SUCCESS: No broken local href/src targets found." -ForegroundColor Green
} else {
    Write-Host "BROKEN TARGETS FOUND: $($missing.Count)" -ForegroundColor Red
    $missing | Format-Table -AutoSize
    exit 1
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host 'git status'
Write-Host 'git add .'
Write-Host 'git commit -m "Fix broken Pages links and frontend assets"'
Write-Host 'git pull --rebase origin main'
Write-Host 'git push origin main'
