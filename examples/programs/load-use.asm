# Full forwarding inserts one bubble between LW and ADDI.
LI r1, 256
LI r2, 41
SW r2, 0(r1)
LW r3, 0(r1)
ADDI r4, r3, 1
HALT
