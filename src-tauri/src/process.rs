use tracing::debug;

#[cfg(target_os = "windows")]
pub fn get_process_tree(root_pid: u32) -> Vec<u32> {
    use winapi::um::tlhelp32::{CreateToolhelp32Snapshot, Process32First, Process32Next, TH32CS_SNAPPROCESS, PROCESSENTRY32};
    use winapi::um::handleapi::CloseHandle;
    use winapi::shared::minwindef::FALSE;

    let mut procs = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if !snapshot.is_null() {
            let mut entry: PROCESSENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;
            if Process32First(snapshot, &mut entry) != FALSE {
                loop {
                    procs.push((entry.th32ProcessID, entry.th32ParentProcessID));
                    if Process32Next(snapshot, &mut entry) == FALSE {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
        }
    }

    let mut tree = vec![root_pid];
    let mut added = true;
    while added {
        added = false;
        let mut new_children = Vec::new();
        for &parent in &tree {
            for &(pid, ppid) in &procs {
                if ppid == parent && !tree.contains(&pid) && !new_children.contains(&pid) {
                    new_children.push(pid);
                    added = true;
                }
            }
        }
        if !new_children.is_empty() {
            tree.extend(new_children);
        }
    }
    tree
}

#[cfg(target_os = "windows")]
pub fn kill_process_tree(root_pid: u32) {
    use winapi::um::processthreadsapi::{OpenProcess, TerminateProcess};
    use winapi::um::winnt::PROCESS_TERMINATE;
    use winapi::shared::minwindef::FALSE;
    use winapi::um::handleapi::CloseHandle;

    let pids = get_process_tree(root_pid);
    for pid in pids.into_iter().rev() {
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
            if !h.is_null() {
                let _ = TerminateProcess(h, 1);
                CloseHandle(h);
                debug!("Terminated process PID {}", pid);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn mod_threads_in_tree(root_pid: u32, suspend: bool) -> Result<(), String> {
    use winapi::um::processthreadsapi::{OpenThread, SuspendThread, ResumeThread};
    use winapi::um::tlhelp32::{CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32};
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::winnt::THREAD_SUSPEND_RESUME;
    use winapi::shared::minwindef::FALSE;

    let pids = get_process_tree(root_pid);
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot.is_null() {
            return Err("Failed to create snapshot".to_string());
        }
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        if Thread32First(snapshot, &mut entry) != FALSE {
            loop {
                if pids.contains(&entry.th32OwnerProcessID) {
                    let thread = OpenThread(THREAD_SUSPEND_RESUME, FALSE, entry.th32ThreadID);
                    if !thread.is_null() {
                        if suspend {
                            SuspendThread(thread);
                        } else {
                            ResumeThread(thread);
                        }
                        CloseHandle(thread);
                    }
                }
                if Thread32Next(snapshot, &mut entry) == FALSE {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn suspend_process(pid: u32) -> Result<(), String> {
    debug!("Suspending process PID {}", pid);
    mod_threads_in_tree(pid, true)
}

#[cfg(target_os = "windows")]
pub fn resume_process(pid: u32) -> Result<(), String> {
    debug!("Resuming process PID {}", pid);
    mod_threads_in_tree(pid, false)
}
