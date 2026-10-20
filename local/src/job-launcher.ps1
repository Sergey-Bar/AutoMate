# Starts a command inside a Windows Job Object that kills every process in it when the job
# closes, then waits for the command. Throwaway prototype for spike S4; see
# docs/local/feasibility.md for what it did and did not show.
#
# Usage: powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File job-launcher.ps1
#          '<json>'   where json is {"file": "...", "args": ["...", ...]} or, to pass the\n#                     command line through untouched, {"file": "...", "raw": "..."}
#
# The command arrives as one JSON argument because PowerShell would otherwise read an
# argument such as -e as one of its own parameters.
#
# The launcher puts ITSELF in the job first, so everything it starts afterwards, and
# everything those processes start, is a member without a race. The job closes when the
# launcher exits or is terminated, because the launcher holds the only handle.
#
# Exit codes 3000101-3000104 mean the launcher itself failed (no job object, or the command
# could not be started). They are not a command's exit code; a command could in principle
# return the same number, which the caller accepts and documents.
#
# Limits worth knowing: x64 only (the structure size is hard-coded); it needs Add-Type to
# compile a small C# type, which Constrained Language Mode or an application allow-list can
# block; and a process created with CREATE_BREAKAWAY_FROM_JOB leaves the job.
param([Parameter(Mandatory = $true, Position = 0)][string]$Spec)

$request = $Spec | ConvertFrom-Json
$Command = $request.file
$Arguments = @($request.args)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JobNative {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
}
'@

$size = 144  # JOBOBJECT_EXTENDED_LIMIT_INFORMATION on x64
$info = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
for ($i = 0; $i -lt $size; $i++) { [System.Runtime.InteropServices.Marshal]::WriteByte($info, $i, 0) }
# BasicLimitInformation.LimitFlags is at offset 16: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
[System.Runtime.InteropServices.Marshal]::WriteInt32($info, 16, 0x2000)

$job = [JobNative]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { exit 3000101 }
if (-not [JobNative]::SetInformationJobObject($job, 9, $info, $size)) { exit 3000102 }
$self = [System.Diagnostics.Process]::GetCurrentProcess()
if (-not [JobNative]::AssignProcessToJobObject($job, $self.Handle)) { exit 3000103 }

$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $Command
if ($null -ne $request.raw) {
  # The caller supplied the exact command line, as cmd.exe's own quoting rules need.
  $start.Arguments = [string]$request.raw
} else {
  $start.Arguments = ($Arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
}
$start.UseShellExecute = $false
try { $child = [System.Diagnostics.Process]::Start($start) } catch { exit 3000104 }
$child.WaitForExit()
exit $child.ExitCode
