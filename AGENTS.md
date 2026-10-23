=== foundation rules ===

# Tasks
- .tasks directory
- Each task are on different sub-directories to track the status of them.
- The `.md` file should be moved to track the status-

## Directories

* new: They are the task to be executed. The user indicates which task's should be executed.
* running: They are the tasks running/executing. 
* review: They are the task to be mark as "completed" by the user. When the agent "finish the execution" need moves the `task md` to review directory and ask if the task are completed.
* completed: They are the task completed.

## Task content structure
Each task md file has the next structure .

```
title: the title task
context: (sometimes) contex for the execution.
description: what to do.

commit-title: when review are accepted you can suggest a commit title
commit-description: when review are accepted yo can suggest a commit description
summary: resume of execution
```