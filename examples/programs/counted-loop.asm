# Sum 0 through 9 into r3.
LI r1, 0
LI r2, 10
LI r3, 0
loop: ADD r3, r3, r1
ADDI r1, r1, 1
BLT r1, r2, loop
HALT
