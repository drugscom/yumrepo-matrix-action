# RPM specs matrix generator

This action generates job matrix for all RPM specs in the project.

## Inputs

### `force`

Ignore SimpleDB metadata. Default `"false"`.

### `paths`

The paths where to look for RPM specs. Default `"."` (project root).

### `recursive`

Search recursively. Default `"true"`.

### `sdb-domain`

AWS SimpleDB domain. Default `"packages"`.

## Outputs

### `matrix`

The job matrix.

## Example usage

```yaml
uses: drugscom/yumrepo-matrix-action@v1
env:
  AWS_REGION: us-east-1
  AWS_ACCESS_KEY_ID: AAAAAAAAAAAAAAA
  AWS_SECRET_ACCESS_KEY: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```