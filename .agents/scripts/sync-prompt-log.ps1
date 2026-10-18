# .agents/scripts/sync-prompt-log.ps1
# 会話トランスクリプト(transcript_full.jsonl / transcript.jsonl)から
# ユーザー入力プロンプトおよび質疑応答を抽出し、making/logs/YYYY-MM-DD.md に自動追記するスクリプト

param(
    [switch]$FromHook,
    [string]$ConversationId = "",
    [string]$WorkspaceRoot = ""
)

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$isStopEvent = $false

try {
    # Hook経由(-FromHook)の場合のみ標準入力からJSONペイロードを読み取る
    $stdinText = ""
    if ($FromHook -and [Console]::IsInputRedirected) {
        $stdinText = [Console]::In.ReadToEnd()
    }

    $payload = $null
    if (-not [string]::IsNullOrWhiteSpace($stdinText)) {
        $payload = $stdinText | ConvertFrom-Json -ErrorAction SilentlyContinue
    }

    if ($null -ne $payload) {
        if ($payload.PSObject.Properties.Name -contains "terminationReason") {
            $isStopEvent = $true
        }
        if ([string]::IsNullOrWhiteSpace($ConversationId) -and $payload.conversationId) {
            $ConversationId = $payload.conversationId
        }
        if ([string]::IsNullOrWhiteSpace($WorkspaceRoot) -and $payload.workspacePaths -and $payload.workspacePaths.Count -gt 0) {
            $WorkspaceRoot = $payload.workspacePaths[0]
        }
    }

    # WorkspaceRootの解決（未指定時はスクリプト位置 .agents/scripts の2階層上）
    if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
        $WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
    }

    $brainDir = Join-Path $env:USERPROFILE ".gemini\antigravity\brain"

    # トランスクリプトファイルの探索（切り詰めなしの transcript_full.jsonl を優先）
    $transcriptFile = $null
    if (-not [string]::IsNullOrWhiteSpace($ConversationId)) {
        $candidateFull = Join-Path $brainDir "$ConversationId\.system_generated\logs\transcript_full.jsonl"
        $candidateCompact = Join-Path $brainDir "$ConversationId\.system_generated\logs\transcript.jsonl"
        if (Test-Path $candidateFull) {
            $transcriptFile = $candidateFull
        }
        elseif (Test-Path $candidateCompact) {
            $transcriptFile = $candidateCompact
        }
    }
    if ($null -eq $transcriptFile -and $null -ne $payload -and $payload.transcriptPath -and (Test-Path $payload.transcriptPath)) {
        $fullFromPayload = $payload.transcriptPath -replace "transcript\.jsonl$", "transcript_full.jsonl"
        if (Test-Path $fullFromPayload) {
            $transcriptFile = $fullFromPayload
        }
        else {
            $transcriptFile = $payload.transcriptPath
        }
    }
    if ($null -eq $transcriptFile) {
        # ConversationId未指定での手動実行時は最新の会話ログを対象にする
        if (Test-Path $brainDir) {
            $latestLog = Get-ChildItem -Path $brainDir -Directory |
                ForEach-Object {
                    $f = Join-Path $_.FullName ".system_generated\logs\transcript_full.jsonl"
                    if (-not (Test-Path $f)) {
                        $f = Join-Path $_.FullName ".system_generated\logs\transcript.jsonl"
                    }
                    if (Test-Path $f) { Get-Item $f }
                } |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1

            if ($null -ne $latestLog) {
                $transcriptFile = $latestLog.FullName
                $ConversationId = $latestLog.Directory.Parent.Parent.Name
            }
        }
    }

    if ($null -ne $transcriptFile -and (Test-Path $transcriptFile)) {
        $logsDir = Join-Path $WorkspaceRoot "making\logs"
        if (-not (Test-Path $logsDir)) {
            New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
        }

        $lines = Get-Content -Path $transcriptFile -Encoding UTF8
        $steps = @()
        foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $obj = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($null -ne $obj) {
                $steps += $obj
            }
        }

        # step_index 順にソート
        $steps = $steps | Sort-Object { [int]$_.step_index }

        foreach ($step in $steps) {
            $stepIdx = $step.step_index

            # 1. USER_INPUT の抽出
            if ($step.type -eq "USER_INPUT" -and -not [string]::IsNullOrWhiteSpace($step.content)) {
                $rawContent = [string]$step.content

                # ローカル時刻の取得（ADDITIONAL_METADATA または created_at から変換）
                $localDt = $null
                if ($rawContent -match "The current local time is:\s*([0-9T:\+\-]+)") {
                    $localDt = [DateTimeOffset]::Parse($Matches[1])
                }
                elseif ($step.created_at) {
                    $localDt = [DateTimeOffset]::Parse($step.created_at).ToLocalTime()
                }
                else {
                    $localDt = [DateTimeOffset]::Now
                }

                $dateStr = $localDt.ToString("yyyy-MM-dd")
                $timeStr = $localDt.ToString("HH:mm:ss")

                # <USER_REQUEST> タグ内の本文を抽出
                $promptText = $rawContent
                if ($rawContent -match "(?s)<USER_REQUEST>\r?\n?(.*?)\r?\n?</USER_REQUEST>") {
                    $promptText = $Matches[1].Trim()
                }
                else {
                    $promptText = $rawContent.Trim()
                }

                if ([string]::IsNullOrWhiteSpace($promptText)) { continue }

                $logFilePath = Join-Path $logsDir "$dateStr.md"
                if (-not (Test-Path $logFilePath)) {
                    $header = "# 作業ログ: $dateStr`r`n"
                    Set-Content -Path $logFilePath -Value $header -Encoding UTF8
                }

                $existingContent = Get-Content -Path $logFilePath -Raw -Encoding UTF8
                if ($null -eq $existingContent) { $existingContent = "" }

                # 既に同じ step_index または同じ時刻ヘッダーが記録されているかチェック
                $escapedTime = [regex]::Escape("[$timeStr]")
                $markerPattern = "(step:\s*$stepIdx\b|$escapedTime)"
                if ($existingContent -notmatch $markerPattern) {
                    $quotedLines = ($promptText -split "\r?\n") | ForEach-Object {
                        if ([string]::IsNullOrWhiteSpace($_)) { ">" } else { "> $_" }
                    }
                    $quotedBlock = $quotedLines -join "`r`n"

                    $entry = @"

---

## [$timeStr] 作業記録
<!-- conv: $ConversationId, step: $stepIdx -->

### ユーザー入力プロンプト
$quotedBlock
"@
                    Add-Content -Path $logFilePath -Value $entry -Encoding UTF8
                }
            }

            # 2. ask_question の回答（A1: ... 等）の抽出
            if ($step.type -eq "GENERIC" -and -not [string]::IsNullOrWhiteSpace($step.content)) {
                $genContent = [string]$step.content
                if ($genContent -match "(?m)^A1:\s*(.+)") {
                    $localDt = if ($step.created_at) { [DateTimeOffset]::Parse($step.created_at).ToLocalTime() } else { [DateTimeOffset]::Now }
                    $dateStr = $localDt.ToString("yyyy-MM-dd")
                    $logFilePath = Join-Path $logsDir "$dateStr.md"

                    if (Test-Path $logFilePath) {
                        $existingContent = Get-Content -Path $logFilePath -Raw -Encoding UTF8
                        $markerPattern = "step:\s*$stepIdx\b"
                        if ($existingContent -notmatch $markerPattern) {
                            $ansLines = ($genContent -split "\r?\n") | Where-Object { $_ -match "^A\d+:" } | ForEach-Object { "- $_" }
                            $ansBlock = $ansLines -join "`r`n"
                            $qaEntry = @"

### 質疑応答・方針選択
<!-- conv: $ConversationId, step: $stepIdx -->
$ansBlock
"@
                            Add-Content -Path $logFilePath -Value $qaEntry -Encoding UTF8
                        }
                    }
                }
            }
        }
    }
}
catch {
    # Hookエラーでエージェント実行を止めないよう握りつぶす
}

# Hookコントラクトに従ったJSON出力
if ($isStopEvent) {
    Write-Output '{"decision": "stop"}'
}
else {
    Write-Output '{}'
}
