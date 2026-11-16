### Added
- Hunter's free company search is a lead source. With the operator's own Hunter key (a free account is enough), the sales seat's `sales/gather` takes source `hunter-discover` and one plain sentence describing the companies it wants; it returns up to 500 a call in the audience's countries, each with how many named people Hunter holds there. It spends no credits and is allowed whatever the paid lead data setting says.
- POSITIONS, CHIEF REVENUE OFFICER, SETTINGS shows the attached Hunter account's plan and the credits left this month, and says what a free Hunter account gives when no key is attached.
### Fixed
- A Hunter people lookup now asks only for named people with a role, so a company where Hunter holds nobody the house could write to costs no credit (it used to be asked for everything, counted as one credit, and the nameless addresses thrown away). A lookup is refused, unspent, where the company search already said Hunter holds no named person.
