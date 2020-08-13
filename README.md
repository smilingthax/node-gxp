node-gxp: Matrox GXP (DualHead2Go-DP) USB protocol
==================================================

NOTE:
 * **Use At Your Own Risk**.
 * Only tested with DualHead2Go-DP. Some I2C commands seem to be DP-transmitter (Parade DP501HDM) specific; those most certainly have to be different for the DVI or VGA DualHead2Go edition.
 * [smilingthax/edider](https://github.com/smilingthax/edider) can be used to view / edit the current and/or factory edid (esp.: add/remove timing descriptors).
 * On linux you probably want/need something like [51-dh2go.rules](51-dh2go.rules).

KNOWN ISSUES:
 * Command line tool not implemented yet, only the communications library.
 * `set_edid()` not fully implemented / tested yet.

Copyright (c) 2020 Tobias Hoffmann

License: https://opensource.org/licenses/MIT

