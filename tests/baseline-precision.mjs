// BEFORE metric: how many repeated drags into the same gap until float
// midpoint positioning breaks (midpoint collides with a neighbor and the
// order can no longer be expressed). Mirrors getNextPositionForIndex math.
let above = 1024;
let below = 2048;
let drags = 0;
for (;;) {
    const midpoint = (above + below) / 2;
    if (midpoint === above || midpoint === below) {
        break;
    }
    below = midpoint; // dragged task becomes the new lower neighbour
    drags += 1;
}
console.log(`midpoint positioning breaks after ${drags} same-gap drags`);
