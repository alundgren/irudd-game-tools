# Install and update Irudd Workshop

Run the [install command for your operating system](../README.md). The installer fetches the source, sets up the build tools and opens the app. You can start a character in memory or choose a folder for a project.

## Windows

Open **Irudd Workshop** or **Irudd Player** from the Start menu. The installer adds the `irudd` command to your user PATH. Open a new terminal to use it.

The app checks for updates at startup. Choose **Restart to update** when a build is ready. **Previous version** reopens the preceding build on the same project. A failed update leaves the current build available.

Program files live in `%LOCALAPPDATA%\irudd-game-tools`, settings in `%APPDATA%\Irudd Workshop`, and agent credentials in `%LOCALAPPDATA%\irudd\workshop`.

## Mac

If Git asks for developer tools, run `xcode-select --install`, finish the installation, then run the Mac install command. Find **Irudd Workshop** in `~/Applications`. The CLI is at `~/.local/bin/irudd`.

To update, rerun the install command, quit the app and reopen it. Builds live in `~/Library/Application Support/Irudd Workshop Installer`. Projects and credentials are stored separately.
