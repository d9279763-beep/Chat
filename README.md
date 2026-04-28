# Project Notes

## Important legal/safety note

This project does **not** provide or include an importable iOS mod for Among Us.  
On iPhone, modifying a closed-source game client typically violates terms of service and platform rules.

## Added feature: social deduction host helper API

If you want a **Town of Host-style experience** without patching the game binary, use the backend host-helper endpoint:

- `POST /api/social-deduction/assign-roles`

Example payload:

```json
{
  "players": ["Alex", "Blair", "Casey", "Drew", "Emery", "Flynn"],
  "impostor_count": 2,
  "include_neutral_role": true,
  "extra_roles": [
    { "role": "Sheriff", "count": 1 },
    { "role": "Engineer", "count": 1 }
  ]
}
```

The endpoint returns deterministic role assignments and a role breakdown so a host app can privately distribute roles to players.

## PC (Steam) C++ host utility

For desktop/Steam sessions, use the C++ companion tool in `tools/steam_host_helper.cpp`.

Build:

```bash
g++ -std=c++17 -O2 -o steam_host_helper tools/steam_host_helper.cpp
```

Run:

```bash
./steam_host_helper \
  --players "Alex,Blair,Casey,Drew,Emery,Flynn" \
  --impostors 2 \
  --jester \
  --extra "Sheriff:1,Engineer:1"
```

This utility generates deterministic role assignments from a seed and is intended for host-side role distribution only.
