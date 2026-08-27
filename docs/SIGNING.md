# macOS code signing & notarization

The release workflow can sign and notarize the macOS build, but it only does so when the
signing secrets exist. With no secrets set, `.github/workflows/release.yml` prints a warning
and releases the same ad-hoc signed build as before — nothing breaks while you are not yet
enrolled.

## Why dodb cares about the signature

Two reasons, one of them immediate:

1. **Gatekeeper.** An ad-hoc build is refused on first launch ("cannot verify the developer"),
   so everyone installing the `.dmg` — including `brew install --cask` users — has to clear the
   quarantine flag by hand. Only a notarized Developer ID build removes that step.
2. **The keychain, if we ever want it back.** dodb used to keep its master key in the login
   keychain and had to give up: an app whose signature is `adhoc, linker-signed` has no stable
   code identity for macOS to record in the item's ACL, so it asks for the keychain password on
   *every* launch and "Always Allow" does not stick. macOS therefore keeps the key in
   `~/.dodb/.master_key` today — see [`MASTER_KEY.md`](MASTER_KEY.md). A certificate-signed
   build is the prerequisite for revisiting that.

Windows is unaffected either way: Credential Manager is keyed to the login account, not to the
executable's signature.

## What you need

| Item | Where | Cost |
| --- | --- | --- |
| Apple Developer Program membership | <https://developer.apple.com/programs/> | 99 USD/year |
| *Developer ID Application* certificate | developer.apple.com → Certificates | included |
| App-specific password | <https://appleid.apple.com> → Sign-In and Security | free |
| Team ID | developer.apple.com/account → Membership details | free |

Notarization is only possible with a Developer ID certificate, so it comes with the membership.

## Once you are enrolled

1. **Create the certificate.** Xcode → Settings → Accounts → *Manage Certificates* → **+** →
   *Developer ID Application*. Without Xcode: create a CSR in Keychain Access
   (*Certificate Assistant → Request a Certificate From a Certificate Authority*), upload it at
   developer.apple.com/account/resources/certificates/add, download the `.cer`, and double-click
   it to import.
2. **Export it with its private key.** Keychain Access → *My Certificates* → right-click the
   `Developer ID Application: … (TEAMID)` identity → *Export* → `.p12`, and set a password.
3. **Base64 it:** `base64 -i DeveloperID.p12 | pbcopy`
4. **Add the repository secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   | --- | --- |
   | `APPLE_CERTIFICATE` | the base64 blob from step 3 |
   | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password from step 2 |
   | `KEYCHAIN_PASSWORD` | any random string (throwaway CI keychain; optional — the workflow generates one) |
   | `APPLE_ID` | your Apple account email |
   | `APPLE_PASSWORD` | the app-specific password, **not** your Apple ID password |
   | `APPLE_TEAM_ID` | the 10-character Team ID |
   | `APPLE_SIGNING_IDENTITY` | optional override, e.g. `Developer ID Application: Your Name (TEAMID)` — the workflow finds it in the certificate otherwise |

5. **Tag a release.** The `Set up macOS code signing` step imports the certificate into a
   throwaway keychain, resolves the identity, and exports the variables the Tauri bundler reads.
   All three notarization secrets must be present or the build is signed but not notarized (the
   workflow says so in a warning).

### Check the result

```sh
codesign -dvvv /Applications/dodb.app 2>&1 | grep -E 'Authority|TeamIdentifier|Signature'
codesign -d --requirements - /Applications/dodb.app    # should pin a certificate, not a cdhash
spctl -a -vvv -t exec /Applications/dodb.app           # "source=Notarized Developer ID"
xcrun stapler validate ~/Downloads/dodb_0.2.4_universal.dmg
```

A `Signature=adhoc` line means the secrets were not picked up.

## Interim option without a paid account

A **self-signed** code signing certificate gives the app a stable identity, and the workflow
above already accepts one because it falls back to any code signing identity in the `.p12`.
That is what would make the login keychain usable again (see
[`MASTER_KEY.md`](MASTER_KEY.md)) — verify it before relying on it: launch the signed app twice
and again after a rebuild, and check that no keychain prompt appears.

1. Keychain Access → *Certificate Assistant* → *Create a Certificate…*
2. Name it (e.g. `dodb Release Signing`), *Identity Type*: Self Signed Root,
   *Certificate Type*: **Code Signing**. Keep it in the login keychain.
3. Export it as `.p12` and add `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` exactly as
   above. Leave the notarization secrets unset.

What this does **not** buy: Gatekeeper still refuses the app on first launch ("cannot verify the
developer"), the same as an ad-hoc build, so `brew install --cask` users keep clearing the
quarantine flag by hand. Keep the certificate and its `.p12` backed up — signing a later release
with a different certificate makes the app a different identity again.

## Local development

Nothing here is needed for day-to-day work: unsigned dev builds keep the master key in a file,
so they never touch the login keychain. To keep dev data out of `~/.dodb` as well:

```sh
DODB_DATA_DIR=/tmp/dodb-dev make dev
```
