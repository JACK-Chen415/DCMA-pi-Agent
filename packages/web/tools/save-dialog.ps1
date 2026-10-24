$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$options = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:DCMA_EXPORT_OPTIONS)) | ConvertFrom-Json
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$owner = New-Object System.Windows.Forms.Form
try {
    $owner.ShowInTaskbar = $false
    $owner.Opacity = 0
    $owner.TopMost = $true
    $owner.Show()
    $dialog.Title = 'DCMA - Save As'
    $dialog.InitialDirectory = $options.directory
    $dialog.FileName = $options.name
    $dialog.DefaultExt = $options.extension.TrimStart('.')
    $dialog.Filter = "DCMA (*$($options.extension))|*$($options.extension)"
    $dialog.AddExtension = $true
    $dialog.CheckPathExists = $true
    $dialog.OverwritePrompt = $true
    $dialog.RestoreDirectory = $true
    $dialog.add_FileOk({
        param($sender, $eventArgs)
        if ($sender.FileName -match '^C:') {
            $eventArgs.Cancel = $true
            [void][System.Windows.Forms.MessageBox]::Show('Please choose a location outside drive C.', 'DCMA')
        }
    })
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::Write((ConvertTo-Json -Compress -InputObject $dialog.FileName))
    } else {
        [Console]::Write('null')
    }
} finally {
    $dialog.Dispose()
    $owner.Dispose()
}
