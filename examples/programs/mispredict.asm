# Use always-not-taken and watch the wrong path get squashed.
LI r1, 1
BEQ r1, r1, target
ADDI r2, r0, 99
SW r1, 512(r0)
target: ADDI r3, r0, 7
HALT
