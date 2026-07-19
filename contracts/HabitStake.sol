// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title HabitStake — stake MON on your own discipline.
/// @notice Lock a stake, check in every window, or your beneficiary takes the pot.
contract HabitStake {
    enum Status { Active, Completed, Slashed }

    struct Commitment {
        address owner;        // person building the habit
        address beneficiary;  // gets the stake on failure (friend / charity)
        uint96  stake;        // locked MON (wei)
        uint32  window;       // max seconds between check-ins
        uint32  minGap;       // min seconds between check-ins (blocks spamming them all at once)
        uint16  required;     // check-ins needed to win
        uint16  done;         // check-ins completed
        uint64  lastCheckIn;  // timestamp of last check-in (starts at creation)
        bool    refereeMode;  // if true, only the beneficiary can confirm check-ins
        Status  status;
        string  habit;        // "gym", "write 500 words", ...
    }

    uint256 public nextId;
    mapping(uint256 => Commitment) public commitments;

    event Created(uint256 indexed id, address indexed owner, address indexed beneficiary, uint256 stake, string habit);
    event CheckedIn(uint256 indexed id, uint16 done, uint16 required);
    event Slashed(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event Withdrawn(uint256 indexed id, address indexed owner, uint256 amount);

    error NotAllowed();
    error WrongStatus();
    error TooEarly();
    error TooLate();
    error NotFailedYet();
    error NotFinished();
    error TransferFailed();

    function create(
        address beneficiary,
        uint32 window_,
        uint32 minGap_,
        uint16 required_,
        bool refereeMode_,
        string calldata habit_
    ) external payable returns (uint256 id) {
        require(msg.value > 0, "stake something");
        require(beneficiary != address(0) && beneficiary != msg.sender, "bad beneficiary");
        require(required_ > 0 && window_ > 0 && minGap_ < window_, "bad params");

        id = nextId++;
        commitments[id] = Commitment({
            owner: msg.sender,
            beneficiary: beneficiary,
            stake: uint96(msg.value),
            window: window_,
            minGap: minGap_,
            required: required_,
            done: 0,
            lastCheckIn: uint64(block.timestamp),
            refereeMode: refereeMode_,
            status: Status.Active,
            habit: habit_
        });
        emit Created(id, msg.sender, beneficiary, msg.value, habit_);
    }

    /// @notice Log a check-in. In referee mode your friend calls this; otherwise you do.
    function checkIn(uint256 id) external {
        Commitment storage c = commitments[id];
        if (c.status != Status.Active) revert WrongStatus();
        address allowed = c.refereeMode ? c.beneficiary : c.owner;
        if (msg.sender != allowed) revert NotAllowed();
        if (block.timestamp < c.lastCheckIn + c.minGap) revert TooEarly();
        if (block.timestamp > c.lastCheckIn + c.window) revert TooLate(); // window blown — slashable

        c.lastCheckIn = uint64(block.timestamp);
        c.done += 1;
        emit CheckedIn(id, c.done, c.required);
    }

    /// @notice Anyone can trigger the slash once a window is blown. Stake goes to the beneficiary.
    function slash(uint256 id) external {
        Commitment storage c = commitments[id];
        if (c.status != Status.Active) revert WrongStatus();
        if (c.done >= c.required) revert NotFailedYet(); // already won — can't be slashed
        if (block.timestamp <= c.lastCheckIn + c.window) revert NotFailedYet();

        c.status = Status.Slashed;
        uint256 amount = c.stake;
        c.stake = 0;
        (bool ok, ) = c.beneficiary.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Slashed(id, c.beneficiary, amount);
    }

    /// @notice Owner reclaims the full stake after completing all check-ins.
    function withdraw(uint256 id) external {
        Commitment storage c = commitments[id];
        if (c.status != Status.Active) revert WrongStatus();
        if (msg.sender != c.owner) revert NotAllowed();
        if (c.done < c.required) revert NotFinished();

        c.status = Status.Completed;
        uint256 amount = c.stake;
        c.stake = 0;
        (bool ok, ) = c.owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(id, c.owner, amount);
    }
}
