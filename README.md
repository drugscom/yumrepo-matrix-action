# RPM specs matrix generator

This action generates job matrix for all RPM specs in the project.

## Inputs

### `force`

Force rebuild packages. Default `"false"`.

### `paths`

The paths where to look for RPM specs. Default `"."` (project root).

### `recursive`

Search recursively. Default `"true"`.

## Outputs

### `matrix`

The job matrix.

## Example usage

```yaml
uses: drugscom/yumrepo-matrix-action@v1
```