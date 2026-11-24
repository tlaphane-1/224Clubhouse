# Lessons

## 2026-10-05 — Never end a turn on an announcement
- Mistake: three times I wrote "next I'll do X" and ended the turn without the tool call, so nothing happened and the owner had to ask "why are you waiting / is it working".
- Rule: a message that says I'm doing something must contain the tool call that does it, in the same turn. If I can't act yet, say what I'm blocked on instead.

## 2026-10-30: owner said "info overload"
- Pattern: long replies with numbered lists, sub-points and "still missing" sections.
- Rule: give the owner at most three short points plus one clear next step. Put the detail in a file and point to it.

## 2026-11-24: untracking a file deleted the owner's local copy
- Mistake: I untracked `.claude/settings.local.json` on a branch and added it to `.gitignore`. Switching back to `master`, where the file was still tracked, silently overwrote the ignored local copy. The pull of the merged deletion then removed it. About 60 lines of saved permission rules were lost; only the old committed 18 lines could be restored.
- Rule: before untracking a file that must stay on disk, copy it to the scratchpad. After merging, check the local copy still exists. If it doesn't, restore it from the scratchpad. Git treats ignored files as expendable on checkout.
