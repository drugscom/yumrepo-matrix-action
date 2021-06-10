# RPM specs matrix generator

This action generates job matrix for all RPM specs in the project.

## Inputs

### `paths`

The paths where to look for RPM specs. Default `"."` (project root).

### `recursive`

Search recursively. Default `"true"`.

### `bundle`

Bundle specs in build dependency groups. Default `"true"`.

### `force`

Ignore SimpleDB metadata. Default `"false"`.

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