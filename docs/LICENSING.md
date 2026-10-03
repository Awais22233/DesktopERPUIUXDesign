# Licensing (vendor guide)

Each installation needs a **license key** bound to one computer. The key is signed with a private key that only you hold; the
application contains only the public key, so it can check keys but can never create them.

## One-time setup (do this on YOUR computer, before the first real client)

```
pnpm license init
```

- Creates the **private key** in `~/.erp-license/private.pem` (Windows: `C:\Users\<you>\.erp-license\private.pem`).
- Writes the matching **public key** into `src/main/license/publicKey.ts`. Commit that file; rebuild the installer.
- **Back the private key up offline (USB, password manager). Never commit it, never email it.** If it is lost you cannot issue
  new keys for existing installers; if it leaks anyone can create licenses.
- `init` refuses to run again (it would invalidate every issued license). `--force` overrides.

## Installing at a client

1. Install the app on the client's PC and open it. It shows a **Computer ID** (like `1AD5C-2124E-2806F-028AD`).
2. Issue a key for that ID:

```
pnpm license issue --client "Faraz Cloth House" --profile cloth --machine 1AD5C-2124E-2806F-028AD
pnpm license issue --client "Glow Cosmetics" --profile cosmetics --machine <ID> --expires 2027-12-31
```

3. Send the key (WhatsApp is fine). The client pastes it into the activation screen. It works offline.

`--profile` decides the business type (cloth or cosmetics). The client cannot change it. `--expires` is optional
(omit it for a permanent license).

Every key you issue is recorded in `~/.erp-license/issued.log`. Check any key with `pnpm license inspect <key>`.

## What this protects, and what it does not

- A key only works on the computer it was issued for, so copying the installer or key to another PC does not activate it.
- The key cannot be edited (the signature breaks), and the client cannot switch to another business type.
- The packaged app has developer tools off, cannot be run as a Node interpreter, and refuses a modified application bundle.

No offline protection is unbreakable. A determined developer with enough time can patch any desktop application. This stops
casual sharing, which is the realistic risk. Pair it with a contract clause about not sharing the software.

## When a client changes computer or reinstalls Windows

The Computer ID can change (new PC, or Windows reinstalled). Ask for the new ID and issue a new key. Their data is not
affected; copy the data folder or restore a backup on the new PC first.
