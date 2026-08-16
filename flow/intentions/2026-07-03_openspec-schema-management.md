# OpenSpec Schema Management

Search this to understand it `https://github.com/Fission-AI/OpenSpec`; Then make the global cmd; a. put information , reference about managing / crud of openspec schema. Wiring to the specific project (ask user first). Always callsout if it replaced the one currently in the project. Usually these will inherit from the base default of openspec , but sometimes it is completely different; Then , after configured , it must also callsout for any potential problem for that created workflow and ALWAYS shout loudly if the completed schema is NOT 100% of the development cycle (be able to full drive from START -> COMPLETED). Pointing to where is it is having the gaps. Also , for our custom schema , our standard naming will be: `01-<stepName>`; (01 , 02 , 03 ,... ) to easily illustrate the step order. Option step will be having 01-<stepName>-opt;

---

## Elaboration

User requested creation of a global command (`init-openspec-schema`) for managing OpenSpec schemas with these requirements:

1. **Global scope** - works on ANY project, project-agnostic
2. **Schema CRUD** - create, read, update, delete OpenSpec schemas
3. **Project wiring** - ask user which project to apply to
4. **Replacement callout** - MUST warn if replacing existing schema
5. **Gap analysis** - MUST verify schema covers full START → COMPLETED cycle
6. **Problem callout** - MUST identify potential issues with created workflow
7. **Naming convention** - `NN-<stepName>` for required steps, `NN-<stepName>-opt` for optional

Later refinements:
- Use `01-opsx-<name>` format (with `opsx-` namespace prefix)
- DRY principle: opencode as canonical, symlink to other tools
- Update global pi prompts (`~/.pi/agent/prompts/`) with opsx commands
- Research schema variants and archive/sync behavior
